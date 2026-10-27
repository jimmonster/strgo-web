use crate::protocol::{codec, ClientMessage, ServerMessage, FRAME_LIMIT};
use crate::account::{self, Account};
use anyhow::{bail, Result};
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, DefaultBodyLimit, State},
    http::{header, HeaderMap, HeaderValue, StatusCode, Uri},
    middleware, response::{IntoResponse, Response}, routing::get, Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use std::{collections::HashMap, net::SocketAddr, path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use std::os::unix::fs::FileTypeExt;
use tokio::{net::UnixStream, sync::Semaphore, time};
use tokio_util::codec::Framed;

struct Settings {
    origin: String,
    accounts: SocketAddr,
    broker: PathBuf,
    users: Mutex<HashMap<String, usize>>,
    slots: Arc<Semaphore>,
}
type AppState = Arc<Settings>;

struct UserSlot { state: AppState, owner: String }
impl Drop for UserSlot {
    fn drop(&mut self) {
        let mut users = self.state.users.lock().unwrap();
        if let Some(count) = users.get_mut(&self.owner) {
            *count -= 1;
            if *count == 0 { users.remove(&self.owner); }
        }
    }
}

pub async fn run() -> Result<()> {
    let origin = std::env::var("TERMINAL_PUBLIC_ORIGIN").unwrap_or("https://strgo.com".into()).trim_end_matches('/').to_owned();
    let uri: Uri = origin.parse()?;
    if !matches!(uri.scheme_str(), Some("http" | "https")) || uri.authority().is_none()
        || uri.authority().unwrap().as_str().contains('@') || uri.path() != "/" || uri.query().is_some()
    { bail!("TERMINAL_PUBLIC_ORIGIN must be an HTTP(S) origin without a path"); }
    let bind: SocketAddr = std::env::var("TERMINAL_BIND").unwrap_or("127.0.0.1:3081".into()).parse()?;
    if !bind.ip().is_loopback() { bail!("The web service must bind to a loopback address behind Nginx"); }
    let accounts: SocketAddr = std::env::var("TERMINAL_ACCOUNT_ADDRESS").unwrap_or("127.0.0.1:8092".into()).parse()?;
    if !accounts.ip().is_loopback() { bail!("Account service must use a loopback address"); }
    let settings = Arc::new(Settings {
        origin, accounts,
        broker: std::env::var("TERMINAL_BROKER_SOCKET").unwrap_or("/run/strgo-terminal/broker.sock".into()).into(),
        users: Mutex::new(HashMap::new()),
        slots: Arc::new(Semaphore::new(32)),
    });
    let app = Router::new()
        .route("/terminal", get(index))
        .route("/terminal/", get(index))
        .route("/terminal/style.css", get(css))
        .route("/terminal/session", get(session_page))
        .route("/terminal/workspace.js", get(workspace_js))
        .route("/terminal/workspace.css", get(workspace_css))
        .route("/terminal/app.js", get(javascript))
        .route("/terminal/i18n.js", get(i18n_js))
        .route("/terminal/i18n-copy.js", get(i18n_copy_js))
        .route("/terminal/i18n-traditional.js", get(i18n_traditional_js))
        .route("/terminal/vendor/xterm.js", get(xterm_js))
        .route("/terminal/vendor/xterm.css", get(xterm_css))
        .route("/terminal/vendor/addon-fit.js", get(fit_js))
        .route("/terminal/api/session", get(session_status))
        .route("/terminal/api/health", get(health))
        .route("/terminal/ws", get(websocket))
        .layer(DefaultBodyLimit::max(2048))
        .layer(middleware::map_response(security_headers))
        .with_state(settings);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    eprintln!("Terminal web service listening on {bind}; public route /terminal");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown()).await?;
    Ok(())
}

async fn shutdown() {
    let ctrl_c = async { let _ = tokio::signal::ctrl_c().await; };
    let terminate = async {
        if let Ok(mut signal) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}

async fn security_headers(mut response: Response) -> Response {
    let h = response.headers_mut();
    for (name, value) in [
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "SAMEORIGIN"),
        ("referrer-policy", "no-referrer"),
        ("permissions-policy", "camera=(), microphone=(), geolocation=()"),
        ("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'"),
    ] { h.insert(name, HeaderValue::from_static(value)); }
    response
}

fn asset(content: &'static str, mime: &'static str) -> Response {
    ([(header::CONTENT_TYPE, mime)], content).into_response()
}
async fn index() -> Response { asset(include_str!("../web/index.html"), "text/html; charset=utf-8") }
async fn session_page() -> Response { asset(include_str!("../web/session.html"), "text/html; charset=utf-8") }
async fn workspace_js() -> Response { asset(include_str!("../web/workspace.js"), "application/javascript; charset=utf-8") }
async fn workspace_css() -> Response { asset(include_str!("../web/workspace.css"), "text/css; charset=utf-8") }
async fn css() -> Response { asset(include_str!("../web/style.css"), "text/css; charset=utf-8") }
async fn javascript() -> Response { asset(include_str!("../web/app.js"), "application/javascript; charset=utf-8") }
async fn i18n_js() -> Response { asset(include_str!("../web/i18n.js"), "application/javascript; charset=utf-8") }
async fn i18n_copy_js() -> Response { asset(include_str!("../web/i18n-copy.js"), "application/javascript; charset=utf-8") }
async fn i18n_traditional_js() -> Response { asset(include_str!("../web/i18n-traditional.js"), "application/javascript; charset=utf-8") }
async fn xterm_js() -> Response { asset(include_str!("../web/vendor/xterm.js"), "application/javascript; charset=utf-8") }
async fn xterm_css() -> Response { asset(include_str!("../web/vendor/xterm.css"), "text/css; charset=utf-8") }
async fn fit_js() -> Response { asset(include_str!("../web/vendor/addon-fit.js"), "application/javascript; charset=utf-8") }

fn same_origin(headers: &HeaderMap, state: &Settings) -> bool {
    headers.get(header::ORIGIN).and_then(|h| h.to_str().ok()) == Some(state.origin.as_str())
}

fn json_status(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "message": message }))).into_response()
}

async fn session_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(cookie) = account::cookie(&headers) else { return json_status(StatusCode::UNAUTHORIZED, "请先登录账号"); };
    match account::verify(state.accounts, &cookie).await {
        Ok(Some(user)) => {
            let count = state.users.lock().unwrap().get(&user.id).copied().unwrap_or(0);
            Json(serde_json::json!({ "authenticated": true, "user": user, "activeConnections": count, "maxConnections": 8 })).into_response()
        },
        Ok(None) => json_status(StatusCode::UNAUTHORIZED, "账号登录已过期，请重新登录"),
        Err(_) => json_status(StatusCode::SERVICE_UNAVAILABLE, "账号服务暂时不可用，请稍后重试"),
    }
}

async fn health(State(state): State<AppState>) -> Response {
    match tokio::fs::metadata(&state.broker).await {
        Ok(metadata) if metadata.file_type().is_socket() => Json(serde_json::json!({ "status": "ok", "sandbox": "per-session-container" })).into_response(),
        _ => json_status(StatusCode::SERVICE_UNAVAILABLE, "沙箱代理尚未就绪"),
    }
}

async fn websocket(State(state): State<AppState>, headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
    if !same_origin(&headers, &state) { return json_status(StatusCode::FORBIDDEN, "请求来源不匹配"); }
    let Some(cookie) = account::cookie(&headers) else { return json_status(StatusCode::UNAUTHORIZED, "请先登录账号"); };
    let user = match account::verify(state.accounts, &cookie).await {
        Ok(Some(user)) => user,
        Ok(None) => return json_status(StatusCode::UNAUTHORIZED, "账号登录已过期"),
        Err(_) => return json_status(StatusCode::SERVICE_UNAVAILABLE, "账号服务暂时不可用"),
    };
    let Ok(permit) = state.slots.clone().try_acquire_owned() else { return json_status(StatusCode::TOO_MANY_REQUESTS, "连接数量过多"); };
    {
        let mut users = state.users.lock().unwrap();
        let count = users.entry(user.id.clone()).or_default();
        if *count >= 8 { return json_status(StatusCode::TOO_MANY_REQUESTS, "每个账号最多同时连接 8 个终端"); }
        *count += 1;
    }
    let user_slot = UserSlot { state: state.clone(), owner: user.id.clone() };
    upgrade.max_message_size(FRAME_LIMIT).max_frame_size(FRAME_LIMIT).on_upgrade(move |mut socket| async move {
        let _permit = permit;
        let _user_slot = user_slot;
        if relay(&mut socket, &state, user, cookie).await.is_err() {
            let _ = time::timeout(Duration::from_secs(3), ws_send(&mut socket,
                ServerMessage::Error { message: "连接已结束，或沙箱服务暂时不可用".into() })).await;
        }
        let _ = time::timeout(Duration::from_secs(3), socket.send(Message::Close(None))).await;
    })
}

async fn ws_send(socket: &mut WebSocket, message: ServerMessage) -> Result<()> {
    time::timeout(Duration::from_secs(3), socket.send(Message::Text(serde_json::to_string(&message)?))).await??;
    Ok(())
}

fn authorize_request(mut message: ClientMessage, user: &Account) -> Result<ClientMessage> {
    message.validate()?;
    match &mut message {
        ClientMessage::Workspace { owner, .. } => {
            if !owner.is_empty() { bail!("Browser cannot choose workspace owner"); }
            *owner = user.id.clone();
        },
        ClientMessage::Connect { identity, .. } => *identity = user.role == "admin",
        _ => bail!("Expected a connect packet"),
    }
    Ok(message)
}

async fn relay(socket: &mut WebSocket, state: &Settings, user: Account, cookie: String) -> Result<()> {
    let first = time::timeout(Duration::from_secs(20), socket.recv()).await?.ok_or_else(|| anyhow::anyhow!("Socket closed"))??;
    let Message::Text(packet) = first else { bail!("Expected a connect packet"); };
    let message = authorize_request(serde_json::from_str(&packet)?, &user)?;
    if account::verify(state.accounts, &cookie).await?.is_none() { bail!("Session expired"); }
    let stream = time::timeout(Duration::from_secs(5), UnixStream::connect(&state.broker)).await??;
    let mut wire = Framed::new(stream, codec());
    time::timeout(Duration::from_secs(3), wire.send(serde_json::to_vec(&message)?.into())).await??;
    let mut check = time::interval(Duration::from_secs(15));
    check.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
    check.tick().await;
    loop {
        tokio::select! {
            _ = check.tick() => {
                if !matches!(account::verify(state.accounts, &cookie).await, Ok(Some(current)) if current.id == user.id && current.role == user.role) {
                    let _ = time::timeout(Duration::from_secs(2), ws_send(socket, ServerMessage::Error {
                        message: "账号会话已结束或无法核实，请重新登录后连接".into()
                    })).await;
                    break;
                }
                time::timeout(Duration::from_secs(3), socket.send(Message::Ping(Vec::new()))).await??;
            }
            next = socket.recv() => {
                match next {
                    Some(Ok(Message::Text(packet))) => {
                        let message: ClientMessage = serde_json::from_str(&packet)?;
                        message.validate()?;
                        if matches!(message, ClientMessage::Connect { .. } | ClientMessage::Workspace { .. }) { bail!("Already connected"); }
                        time::timeout(Duration::from_secs(3), wire.send(packet.into_bytes().into())).await??;
                        if matches!(message, ClientMessage::Disconnect) { break; }
                    }
                    Some(Ok(Message::Ping(data))) => time::timeout(Duration::from_secs(3), socket.send(Message::Pong(data))).await??,
                    Some(Ok(Message::Pong(_))) => {},
                    _ => break,
                }
            }
            packet = wire.next() => {
                let Some(packet) = packet else { break; };
                let message: ServerMessage = serde_json::from_slice(&packet?)?;
                let terminal = matches!(message, ServerMessage::Exit { .. } | ServerMessage::Error { .. });
                ws_send(socket, message).await?;
                if terminal { break; }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_slot_releases_account_capacity() {
        let state = Arc::new(Settings { origin: "https://strgo.com".into(), accounts: "127.0.0.1:8092".parse().unwrap(),
            broker: "/tmp/test.sock".into(), users: Mutex::new(HashMap::from([("test".into(), 1)])), slots: Arc::new(Semaphore::new(32)) });
        drop(UserSlot { state: state.clone(), owner: "test".into() });
        assert!(state.users.lock().unwrap().is_empty());
    }
    #[test]
    fn browser_cannot_choose_another_workspace_or_inherit_a_service_key() {
        let user = Account { id: "0123456789abcdef0123456789abcdef".into(), username: "member".into(), role: "member".into() };
        let message = authorize_request(ClientMessage::Workspace { owner: String::new(), cols: 80, rows: 24 }, &user).unwrap();
        assert!(matches!(message, ClientMessage::Workspace { owner, .. } if owner == user.id));
        assert!(authorize_request(ClientMessage::Workspace { owner: user.id.clone(), cols: 80, rows: 24 }, &user).is_err());
        let message = authorize_request(ClientMessage::Connect { host: "strgo.com".into(), username: "root".into(), port: 22, cols: 80, rows: 24, identity: true }, &user).unwrap();
        assert!(matches!(message, ClientMessage::Connect { identity: false, .. }));
    }
}
