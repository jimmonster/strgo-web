use crate::access::AccessPolicy;
use crate::protocol::{canonical_ip, codec, ClientMessage, Connect, ServerMessage, MAX_INPUT};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rand::{rngs::OsRng, RngCore};
use std::{io::{Read, Write}, net::IpAddr, os::unix::fs::PermissionsExt, path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use tokio::{net::{UnixListener, UnixStream}, process::Command, sync::{mpsc, Semaphore}, time};
use tokio_util::codec::Framed;

struct Settings {
    image: String,
    network: String,
    access: AccessPolicy,
    ttl: Duration,
    slots: Arc<Semaphore>,
    identity: Option<PathBuf>,
}

enum Target {
    Ssh { connection: Connect, ip: IpAddr, identity: bool },
    Workspace { owner: String, cols: u16, rows: u16 },
}

#[cfg(test)]
mod workspace_tests {
    use super::*;

    fn settings() -> Settings {
        Settings { image: "sandbox:test".into(), network: "ssh-network".into(), access: AccessPolicy::new(false, "", "").unwrap(),
            ttl: Duration::from_secs(3600), slots: Arc::new(Semaphore::new(8)), identity: Some("/etc/terminal/private-key".into()) }
    }
    fn argv(target: Target) -> Vec<String> {
        sandbox_command(&target, "test-container", &settings()).get_argv().iter().map(|s| s.to_string_lossy().to_string()).collect()
    }
    #[test]
    fn workspace_is_offline_nonroot_and_mounts_only_its_account_volume() {
        let owner = "0123456789abcdef0123456789abcdef";
        let args = argv(Target::Workspace { owner: owner.into(), cols: 80, rows: 24 });
        assert!(args.windows(2).any(|a| a == ["--network", "none"]));
        assert!(args.contains(&format!("type=volume,src=strgo-workspace-{owner},dst=/home/terminal")));
        assert!(args.contains(&"--entrypoint=/bin/sh".to_string()));
        assert!(args.contains(&"--user=10001:10001".to_string()));
        assert!(args.contains(&"--read-only".to_string()));
        assert!(!args.iter().any(|a| a.contains("type=bind") || a.contains("private-key")));
        assert_eq!(args.last().unwrap(), "-il");
    }
    #[test]
    fn members_do_not_receive_the_service_ssh_key() {
        let target = || Connect { host: "server.example".into(), username: "user".into(), port: 22, cols: 80, rows: 24 };
        let member = argv(Target::Ssh { connection: target(), ip: "8.8.8.8".parse().unwrap(), identity: false });
        assert!(!member.iter().any(|a| a.contains("type=bind")));
        let admin = argv(Target::Ssh { connection: target(), ip: "8.8.8.8".parse().unwrap(), identity: true });
        assert!(admin.iter().any(|a| a.contains("src=/etc/terminal/private-key,")));
    }
    #[test]
    fn different_accounts_always_have_different_persistent_volumes() {
        let first = argv(Target::Workspace { owner: "a".repeat(32), cols: 80, rows: 24 });
        let second = argv(Target::Workspace { owner: "b".repeat(32), cols: 80, rows: 24 });
        assert_ne!(first.iter().find(|a| a.starts_with("type=volume")), second.iter().find(|a| a.starts_with("type=volume")));
    }
}

impl Target {
    fn size(&self) -> (u16, u16) {
        match self {
            Self::Ssh { connection, .. } => (connection.cols, connection.rows),
            Self::Workspace { cols, rows, .. } => (*cols, *rows),
        }
    }
}

pub async fn run() -> Result<()> {
    let path = PathBuf::from(std::env::var("TERMINAL_BROKER_SOCKET").unwrap_or("/run/strgo-terminal/broker.sock".into()));
    let max: usize = std::env::var("TERMINAL_MAX_SESSIONS").unwrap_or("8".into()).parse()?;
    let ttl: u64 = std::env::var("TERMINAL_SESSION_SECONDS").unwrap_or("3600".into()).parse()?;
    if !(1..=32).contains(&max) || !(60..=86400).contains(&ttl) { bail!("Invalid session limits"); }
    let identity = std::env::var_os("TERMINAL_IDENTITY_FILE").map(PathBuf::from);
    if let Some(path) = &identity {
        if !path.is_absolute() || !path.is_file() || path.to_string_lossy().contains(',') {
            bail!("TERMINAL_IDENTITY_FILE must point to an existing absolute file path");
        }
    }
    let settings = Arc::new(Settings {
        image: std::env::var("TERMINAL_SANDBOX_IMAGE").unwrap_or("strgo-ssh-sandbox:1".into()),
        network: std::env::var("TERMINAL_SANDBOX_NETWORK").unwrap_or("strgo-terminal".into()),
        access: AccessPolicy::new(
            std::env::var("TERMINAL_ALLOW_PRIVATE").as_deref() == Ok("1"),
            &std::env::var("TERMINAL_BLOCKED_IPS").unwrap_or_default(),
            &std::env::var("TERMINAL_ALLOWED_TARGETS").unwrap_or_default(),
        )?,
        ttl: Duration::from_secs(ttl),
        slots: Arc::new(Semaphore::new(max)),
        identity,
    });
    if path.exists() {
        if UnixStream::connect(&path).await.is_ok() { bail!("A broker is already using {}", path.display()); }
        std::fs::remove_file(&path)?;
    }
    // The systemd RuntimeDirectory is root-owned; only the web service's group can connect.
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o660))?;
    cleanup_orphans().await?;
    eprintln!("Sandbox broker listening on {}", path.display());
    loop {
        let (stream, _) = listener.accept().await?;
        let Ok(permit) = settings.slots.clone().try_acquire_owned() else {
            tokio::spawn(async move {
                let mut wire = Framed::new(stream, codec());
                let _ = time::timeout(Duration::from_secs(3), send(&mut wire,
                    ServerMessage::Error { message: "会话数量已达上限，请稍后重试".into() })).await;
            });
            continue;
        };
        let config = settings.clone();
        tokio::spawn(async move {
            let _permit = permit;
            if let Err(error) = handle(stream, config).await {
                eprintln!("Sandbox session ended: {error:#}");
            }
        });
    }
}

async fn send(wire: &mut Framed<UnixStream, tokio_util::codec::LengthDelimitedCodec>, message: ServerMessage) -> Result<()> {
    wire.send(serde_json::to_vec(&message)?.into()).await?;
    Ok(())
}

async fn resolve(target: &Connect, settings: &Settings) -> Result<IpAddr> {
    let addresses = time::timeout(Duration::from_secs(10), tokio::net::lookup_host((target.host.as_str(), target.port)))
        .await.context("域名解析超时")??;
    let addresses: Vec<_> = addresses.map(|a| canonical_ip(a.ip())).collect();
    settings.access.select(&addresses, target.port)
}

async fn handle(stream: UnixStream, settings: Arc<Settings>) -> Result<()> {
    let mut wire = Framed::new(stream, codec());
    let packet = time::timeout(Duration::from_secs(15), wire.next()).await?
        .context("Missing connect request")??;
    let request: ClientMessage = serde_json::from_slice(&packet)?;
    request.validate()?;
    let target = match request {
        ClientMessage::Connect { host, port, username, cols, rows, identity } => {
            let connection = Connect { host, port, username, cols, rows };
            let ip = match resolve(&connection, &settings).await {
                Ok(ip) => ip,
                Err(error) => {
                    send(&mut wire, ServerMessage::Error { message: format!("无法连接：{error}") }).await?;
                    return Ok(());
                }
            };
            Target::Ssh { connection, ip, identity }
        },
        ClientMessage::Workspace { owner, cols, rows } if crate::account::valid_owner(&owner) => Target::Workspace { owner, cols, rows },
        _ => bail!("Expected an authenticated connect request"),
    };
    let mut random = [0u8; 16];
    OsRng.fill_bytes(&mut random);
    let name = format!("strgo-ssh-{}", random.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let cleanup_name = name.clone();
    // Nothing after this point exits without running cleanup, including WebSocket disconnects.
    let outcome = run_container(&mut wire, &target, &name, &settings).await;
    if let Err(error) = remove_container(&cleanup_name).await {
        eprintln!("Sandbox cleanup failed for {cleanup_name}: {error:#}");
    }
    if let Err(error) = outcome {
        let _ = time::timeout(Duration::from_secs(3), send(&mut wire,
            ServerMessage::Error { message: "SSH 会话已结束，或沙箱暂时不可用".into() })).await;
        return Err(error);
    }
    Ok(())
}

async fn run_container(
    wire: &mut Framed<UnixStream, tokio_util::codec::LengthDelimitedCodec>,
    target: &Target, name: &str, settings: &Settings,
) -> Result<()> {
    let ttl = settings.ttl;
    let (cols, rows) = target.size();
    let pair = native_pty_system().openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
    let cmd = sandbox_command(target, name, settings);
    let mut child = pair.slave.spawn_command(cmd).context("Cannot start sandbox process")?;
    drop(pair.slave);
    run_pty(wire, child.as_mut(), pair.master, name, ttl).await
}

fn sandbox_command(target: &Target, name: &str, settings: &Settings) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("/usr/bin/docker");
    for arg in [
        "run", "--rm", "--interactive", "--tty", "--init", "--name", name,
        "--label", "com.strgo.terminal.sandbox=1",
        "--network", if matches!(target, Target::Workspace { .. }) { "none" } else { settings.network.as_str() },
        "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
        "--memory=128m", "--memory-swap=128m", "--cpus=0.5", "--pids-limit=32",
        "--ulimit=nofile=128:128", "--ulimit=nproc=32:32", "--user=10001:10001",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777",
        "--env=HOME=/home/terminal", "--env=TERM=xterm-256color",
        "--log-driver=none", "--pull=never",
    ] { cmd.arg(arg); }
    if let Target::Workspace { owner, .. } = target {
        cmd.arg("--mount");
        cmd.arg(format!("type=volume,src=strgo-workspace-{owner},dst=/home/terminal"));
        cmd.arg("--ulimit=fsize=16777216:16777216");
        cmd.arg("--entrypoint=/bin/sh");
        cmd.arg(settings.image.as_str());
        cmd.arg("-il");
        return cmd;
    }
    cmd.arg("--tmpfs=/home/terminal:rw,noexec,nosuid,nodev,size=8m,uid=10001,gid=10001,mode=0700");
    let Target::Ssh { connection: target, ip, identity: use_identity } = target else { unreachable!() };
    if let Some(identity) = settings.identity.as_ref().filter(|_| *use_identity) {
        // A configured identity is the only permitted host mount; the web process cannot select it.
        cmd.arg("--mount");
        cmd.arg(format!("type=bind,src={},dst=/opt/terminal-key/id_ed25519,readonly", identity.display()));
    }
    cmd.arg(settings.image.as_str());
    for arg in [
        "-F", "/dev/null", "-tt", "-o", "StrictHostKeyChecking=ask",
        "-o", "UserKnownHostsFile=/home/terminal/known_hosts", "-o", "GlobalKnownHostsFile=/dev/null",
        "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
        "-o", "PermitLocalCommand=no", "-o", "EscapeChar=none", "-o", "ConnectTimeout=15",
        "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
        "-o", "NumberOfPasswordPrompts=3", "-o", "UpdateHostKeys=no",
        "-o", "ControlMaster=no", "-o", "ControlPath=none",
        "-o", "IdentityFile=/opt/terminal-key/id_ed25519",
    ] { cmd.arg(arg); }
    cmd.arg("-o"); cmd.arg(format!("HostKeyAlias={}", target.host));
    cmd.arg("-p"); cmd.arg(target.port.to_string());
    cmd.arg("-l"); cmd.arg(&target.username);
    cmd.arg(ip.to_string());
    cmd
}

async fn run_pty(
    wire: &mut Framed<UnixStream, tokio_util::codec::LengthDelimitedCodec>,
    child: &mut (dyn portable_pty::Child + Send + Sync), master: Box<dyn portable_pty::MasterPty + Send>,
    name: &str, ttl: Duration,
) -> Result<()> {
    let master = Mutex::new(master);
    let mut reader = master.lock().unwrap().try_clone_reader()?;
    let mut writer = master.lock().unwrap().take_writer()?;
    let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(16);
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => if output_tx.blocking_send(buffer[..count].to_vec()).is_err() { break; },
            }
        }
    });
    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(16);
    let writer_task = tokio::task::spawn_blocking(move || {
        while let Some(data) = input_rx.blocking_recv() {
            if writer.write_all(&data).and_then(|_| writer.flush()).is_err() { break; }
        }
    });
    // A single deadline also bounds slow browsers, blocked pipes and a hung Docker daemon.
    let result = time::timeout(ttl, async {
        send(wire, ServerMessage::Ready).await?;
        loop {
            tokio::select! {
                output = output_rx.recv() => {
                    match output {
                        Some(data) => send(wire, ServerMessage::Output { data: STANDARD.encode(data) }).await?,
                        None => {
                            let code = child.try_wait()?.map(|status| status.exit_code()).unwrap_or(0);
                            send(wire, ServerMessage::Exit { code }).await?;
                            break;
                        }
                    }
                }
                packet = wire.next() => {
                    let Some(packet) = packet else { break; };
                    let message: ClientMessage = serde_json::from_slice(&packet?)?;
                    message.validate()?;
                    match message {
                        ClientMessage::Input { data } => {
                            if data.len() > MAX_INPUT { bail!("Input too large"); }
                            input_tx.send(data.into_bytes()).await.context("SSH input closed")?;
                        }
                        ClientMessage::Resize { cols, rows } => master.lock().unwrap().resize(PtySize {
                            rows, cols, pixel_width: 0, pixel_height: 0,
                        })?,
                        ClientMessage::Disconnect => break,
                        ClientMessage::Connect { .. } | ClientMessage::Workspace { .. } => bail!("Connection is already established"),
                    }
                }
            }
        }
        Ok::<(), anyhow::Error>(())
    }).await;
    drop(input_tx);
    drop(output_rx);
    // Terminate the container first to close the PTY reader/writer reliably.
    let cleanup = remove_container(name).await;
    let _ = child.kill();
    drop(master);
    let _ = time::timeout(Duration::from_secs(3), reader_task).await;
    let _ = time::timeout(Duration::from_secs(3), writer_task).await;
    cleanup?;
    match result {
        Ok(result) => result,
        Err(_) => {
            let _ = time::timeout(Duration::from_secs(3), send(wire,
                ServerMessage::Error { message: "会话已达到时间上限，请重新连接".into() })).await;
            Ok(())
        }
    }
}

async fn remove_container(name: &str) -> Result<()> {
    let mut command = Command::new("/usr/bin/docker");
    command.args(["rm", "--force", name]).kill_on_drop(true);
    let output = time::timeout(Duration::from_secs(15), command.output()).await??;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // --rm may already have removed the container after SSH exited normally.
        if !stderr.contains("No such container") { bail!("Docker cleanup: {}", stderr.trim()); }
    }
    Ok(())
}

async fn cleanup_orphans() -> Result<()> {
    let mut command = Command::new("/usr/bin/docker");
    command.args(["ps", "--all", "--quiet", "--filter", "label=com.strgo.terminal.sandbox=1"]).kill_on_drop(true);
    let output = time::timeout(Duration::from_secs(15), command.output()).await??;
    if !output.status.success() { bail!("Docker daemon is unavailable"); }
    for id in String::from_utf8(output.stdout)?.split_whitespace() {
        remove_container(id).await?;
    }
    Ok(())
}
