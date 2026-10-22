use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use tokio_util::codec::LengthDelimitedCodec;

pub const FRAME_LIMIT: usize = 32 * 1024;
pub const MAX_INPUT: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connect {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub cols: u16,
    pub rows: u16,
}

impl Connect {
    pub fn validate(&self) -> Result<()> {
        let host = &self.host;
        if host.is_empty() || host.len() > 253 || host.starts_with('-') {
            bail!("服务器地址无效");
        }
        if host.parse::<IpAddr>().is_err()
            && (!host.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.')
                || host.split('.').any(|label| label.is_empty() || label.len() > 63
                    || label.starts_with('-') || label.ends_with('-')))
        {
            bail!("请输入 IP 或域名，不包含协议、路径或空格");
        }
        if self.username.is_empty() || self.username.len() > 64 || self.username.starts_with('-')
            || !self.username.bytes().all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        {
            bail!("SSH 用户名无效");
        }
        if self.port == 0 { bail!("SSH 端口必须为 1–65535"); }
        validate_size(self.cols, self.rows)
    }
}

pub fn validate_size(cols: u16, rows: u16) -> Result<()> {
    if !(10..=400).contains(&cols) || !(2..=150).contains(&rows) {
        bail!("终端尺寸超出范围");
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientMessage {
    Connect { host: String, port: u16, username: String, cols: u16, rows: u16 },
    Input { data: String },
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

impl ClientMessage {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Connect { host, port, username, cols, rows } => Connect {
                host: host.clone(), port: *port, username: username.clone(), cols: *cols, rows: *rows,
            }.validate(),
            Self::Input { data } if data.len() > MAX_INPUT => bail!("单次输入过长，请分段粘贴"),
            Self::Input { .. } | Self::Disconnect => Ok(()),
            Self::Resize { cols, rows } => validate_size(*cols, *rows),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Ready,
    Output { data: String },
    Error { message: String },
    Exit { code: u32 },
}

pub fn codec() -> LengthDelimitedCodec {
    LengthDelimitedCodec::builder().max_frame_length(FRAME_LIMIT).new_codec()
}

fn allowed_v4(ip: Ipv4Addr, allow_private: bool) -> bool {
    let [a, b, c, _] = ip.octets();
    if a == 0 || a == 127 || a >= 224 || (a == 169 && b == 254) {
        return false;
    }
    if ip.is_private() { return allow_private; }
    // Do not route sandbox sessions to metadata, shared address space or reserved ranges.
    !((a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && (c == 0 || c == 2))
        || (a == 198 && ((b == 18 || b == 19) || (b == 51 && c == 100)))
        || (a == 203 && b == 0 && c == 113))
}

pub fn allowed_ip(ip: IpAddr, allow_private: bool) -> bool {
    match ip {
        IpAddr::V4(ip) => allowed_v4(ip, allow_private),
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() { return allowed_v4(v4, allow_private); }
            let s = ip.segments();
            if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast()
                || s[0] & 0xffc0 == 0xfe80 || (s[0] == 0x2001 && s[1] == 0x0db8)
                || (s[0] == 0x100 && s[1..4] == [0, 0, 0])
            { return false; }
            if s[0] & 0xfe00 == 0xfc00 { return allow_private; }
            s[0] & 0xe000 == 0x2000 // Public unicast; other special-use ranges stay blocked.
        }
    }
}

pub fn canonical_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
        _ => ip,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_cannot_inject_ssh_or_docker_options() {
        let mut c = Connect { host: "strgo.com".into(), port: 22, username: "root".into(), cols: 80, rows: 24 };
        assert!(c.validate().is_ok());
        for host in ["-oProxyCommand=sh", "host;id", "user@host", "https://strgo.com", "foo..com", "foo/bar", "foo\nbar"] {
            c.host = host.into(); assert!(c.validate().is_err(), "{host}");
        }
        c.host = "2001:4860:4860::8888".into(); assert!(c.validate().is_ok());
        for user in ["-root", "root;id", "root@host", "a b"] {
            c.username = user.into(); assert!(c.validate().is_err());
        }
    }

    #[test]
    fn infrastructure_addresses_are_rejected_even_when_private_network_is_enabled() {
        for addr in ["127.0.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1"] {
            assert!(!allowed_ip(addr.parse().unwrap(), true), "{addr}");
        }
        for addr in ["10.0.0.1", "172.17.0.1", "192.168.1.2", "fc00::1"] {
            assert!(!allowed_ip(addr.parse().unwrap(), false));
            assert!(allowed_ip(addr.parse().unwrap(), true));
        }
        assert!(allowed_ip("8.8.8.8".parse().unwrap(), false));
        assert_eq!(canonical_ip("::ffff:8.8.8.8".parse().unwrap()), "8.8.8.8".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn oversized_input_and_dimensions_are_rejected() {
        assert!(ClientMessage::Input { data: "x".repeat(MAX_INPUT + 1) }.validate().is_err());
        assert!(validate_size(0, 24).is_err());
        assert!(validate_size(80, 151).is_err());
    }

    #[test]
    fn connect_json_matches_browser_protocol() {
        let packet = r#"{"type":"connect","host":"strgo.com","port":22,"username":"root","cols":80,"rows":24}"#;
        let parsed: ClientMessage = serde_json::from_str(packet).unwrap();
        assert!(parsed.validate().is_ok());
    }
}
