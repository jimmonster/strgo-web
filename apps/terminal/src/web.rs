use crate::protocol::{codec, ClientMessage, ServerMessage, FRAME_LIMIT};
use anyhow::{bail, Result};
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, ConnectInfo, DefaultBodyLimit, State},
    http::{header, HeaderMap, HeaderValue, StatusCode, Uri},
    middleware, response::{IntoResponse, Response}, routing::{get, post}, Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use rand::{rngs::OsRng, RngCore};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, net::{IpAddr, SocketAddr}, path::PathBuf, sync::{Arc, Mutex}, time::{Duration, Instant}};
use std::os::unix::fs::FileTypeExt;
use subtle::ConstantTimeEq;
use tokio::{net::UnixStream, sync::{watch, Semaphore}, time};
use tokio_util::codec::Framed;

const COOKIE: &str = "strgo_terminal";
const SESSION_TTL: Duration = Duration::from_secs(8 * 3600);

#[derive(Clone)]
struct Session { expires: Instant, revoked: watch::Sender<bool> }

struct Settings {
    origin: String,
    secure: bool,
    token_digest: [u8; 32],
    broker: PathBuf,
    sessions: Mutex<HashMap<String, Session>>,
    attempts: Mutex<HashMap<IpAddr, (Instant, u16)>>,
    slots: Arc<Semaphore>,
}
type AppState = Arc<Settings>;

pub async fn run() -> Result<()> {
    let token = std::env::var("TERMINAL_ACCESS_TOKEN")?;
    if token.len() < 32 { bail!("TERMINAL_ACCESS_TOKEN must contain at least 32 characters"); }
    let origin = std::env::var("TERMINAL_PUBLIC_ORIGIN").unwrap_or("https://strgo.com".into()).trim_end_matches('/').to_owned();
    let uri: Uri = origin.parse()?;
    if !matches!(uri.scheme_str(), Some("http" | "https")) || uri.authority().is_none()
        || uri.authority().unwrap().as_str().contains('@') || uri.path() != "/" || uri.query().is_some()
    { bail!("TERMINAL_PUBLIC_ORIGIN must be an HTTP(S) origin without a path"); }
    let bind: SocketAddr = std::env::var("TERMINAL_BIND").unwrap_or("127.0.0.1:3081".into()).parse()?;
    if !bind.ip().is_loopback() { bail!("The web service must bind to a loopback address behind Nginx"); }
    let settings = Arc::new(Settings {
        secure: origin.starts_with("https://"), origin,
        token_digest: Sha256::digest(token.as_bytes()).into(),
        broker: std::env::var("TERMINAL_BROKER_SOCKET").unwrap_or("/run/strgo-terminal/broker.sock".into()).into(),
        sessions: Mutex::new(HashMap::new()), attempts: Mutex::new(HashMap::new()),
        slots: Arc::new(Semaphore::new(32)),
    });
    let app = Router::new()
        .route("/terminal", get(index))
        .route("/terminal/", get(index))
        .route("/terminal/style.css", get(css))
        .route("/terminal/app.js", get(javascript))
        .route("/terminal/vendor/xterm.js", get(xterm_js))
        .route("/terminal/vendor/xterm.css", get(xterm_css))
        .route("/terminal/vendor/addon-fit.js", get(fit_js))
        .route("/terminal/api/login", post(login))
        .route("/terminal/api/session", get(session_status))
        .route("/terminal/api/logout", post(logout))
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
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        ("permissions-policy", "camera=(), microphone=(), geolocation=()"),
        ("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"),
    ] { h.insert(name, HeaderValue::from_static(value)); }
    response
}

fn asset(content: &'static str, mime: &'static str) -> Response {
    ([(header::CONTENT_TYPE, mime)], content).into_response()
}
async fn index() -> Response { asset(include_str!("../web/index.html"), "text/html; charset=utf-8") }
async fn css() -> Response { asset(include_str!("../web/style.css"), "text/css; charset=utf-8") }
async fn javascript() -> Response { asset(include_str!("../web/app.js"), "application/javascript; charset=utf-8") }
async fn xterm_js() -> Response { asset(include_str!("../web/vendor/xterm.js"), "application/javascript; charset=utf-8") }
async fn xterm_css() -> Response { asset(include_str!("../web/vendor/xterm.css"), "text/css; charset=utf-8") }
async fn fit_js() -> Response { asset(include_str!("../web/vendor/addon-fit.js"), "application/javascript; charset=utf-8") }

fn same_origin(headers: &HeaderMap, state: &Settings) -> bool {
    headers.get(header::ORIGIN).and_then(|h| h.to_str().ok()) == Some(state.origin.as_str())
}

fn cookie_value(headers: &HeaderMap) -> Option<String> {
    headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';')).filter_map(|v| v.trim().split_once('='))
        .find(|(key, _)| *key == COOKIE).map(|(_, value)| value.to_string())
}

fn current_session(headers: &HeaderMap, state: &Settings) -> Option<Session> {
    let key = cookie_value(headers)?;
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.get(&key).is_some_and(|s| s.expires <= Instant::now()) {
        if let Some(s) = sessions.remove(&key) { s.revoked.send_replace(true); }
    }
    sessions.get(&key).cloned()
}

fn cookie(value: &str, age: u64, secure: bool) -> String {
    format!("{COOKIE}={value}; Path=/terminal; HttpOnly; SameSite=Strict; Max-Age={age}{}", if secure { "; Secure" } else { "" })
}

fn json_status(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "message": message }))).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Login { token: String }

async fn login(State(state): State<AppState>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<Login>) -> Response {
    if !same_origin(&headers, &state) { return json_status(StatusCode::FORBIDDEN, "请求来源不匹配"); }
    let ip = headers.get("x-real-ip").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<IpAddr>().ok()).unwrap_or(peer.ip());
    {
        let mut attempts = state.attempts.lock().unwrap();
        attempts.retain(|_, (start, _)| start.elapsed() < Duration::from_secs(60));
        if attempts.len() >= 1024 && !attempts.contains_key(&ip) {
            return json_status(StatusCode::TOO_MANY_REQUESTS, "请求过多，请稍后重试");
        }
        let entry = attempts.entry(ip).or_insert((Instant::now(), 0));
        entry.1 += 1;
        if entry.1 > 8 { return json_status(StatusCode::TOO_MANY_REQUESTS, "尝试次数过多，请一分钟后重试"); }
    }
    let digest: [u8; 32] = Sha256::digest(body.token.as_bytes()).into();
    if !bool::from(digest.ct_eq(&state.token_digest)) { return json_status(StatusCode::UNAUTHORIZED, "访问口令不正确"); }
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let key = URL_SAFE_NO_PAD.encode(bytes);
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.retain(|_, s| s.expires > Instant::now());
        // Repeated login replaces this browser's previous session instead of accumulating entries.
        if let Some(old) = cookie_value(&headers).and_then(|key| sessions.remove(&key)) { old.revoked.send_replace(true); }
        if sessions.len() >= 512 { return json_status(StatusCode::TOO_MANY_REQUESTS, "登录会话过多，请稍后重试"); }
        let (revoked, _) = watch::channel(false);
        sessions.insert(key.clone(), Session { expires: Instant::now() + SESSION_TTL, revoked });
    }
    ([(header::SET_COOKIE, cookie(&key, SESSION_TTL.as_secs(), state.secure))], Json(serde_json::json!({ "ok": true }))).into_response()
}

async fn session_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if current_session(&headers, &state).is_some() { Json(serde_json::json!({ "authenticated": true })).into_response() }
    else { json_status(StatusCode::UNAUTHORIZED, "请先输入访问口令") }
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !same_origin(&headers, &state) { return json_status(StatusCode::FORBIDDEN, "请求来源不匹配"); }
    if let Some(key) = cookie_value(&headers) {
        if let Some(s) = state.sessions.lock().unwrap().remove(&key) { s.revoked.send_replace(true); }
    }
    ([(header::SET_COOKIE, cookie("", 0, state.secure))], Json(serde_json::json!({ "ok": true }))).into_response()
}

async fn health(State(state): State<AppState>) -> Response {
    match tokio::fs::metadata(&state.broker).await {
        Ok(metadata) if metadata.file_type().is_socket() => Json(serde_json::json!({ "status": "ok", "sandbox": "per-session-container" })).into_response(),
        _ => json_status(StatusCode::SERVICE_UNAVAILABLE, "沙箱代理尚未就绪"),
    }
}

async fn websocket(State(state): State<AppState>, headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
    if !same_origin(&headers, &state) { return json_status(StatusCode::FORBIDDEN, "请求来源不匹配"); }
    let Some(session) = current_session(&headers, &state) else { return json_status(StatusCode::UNAUTHORIZED, "登录已过期"); };
    let Ok(permit) = state.slots.clone().try_acquire_owned() else { return json_status(StatusCode::TOO_MANY_REQUESTS, "连接数量过多"); };
    upgrade.max_message_size(FRAME_LIMIT).max_frame_size(FRAME_LIMIT).on_upgrade(move |mut socket| async move {
        let _permit = permit;
        if relay(&mut socket, &state, session).await.is_err() {
            let _ = time::timeout(Duration::from_secs(3), ws_send(&mut socket,
                ServerMessage::Error { message: "连接已结束，或沙箱服务暂时不可用".into() })).await;
        }
        let _ = time::timeout(Duration::from_secs(3), socket.send(Message::Close(None))).await;
    })
}

async fn ws_send(socket: &mut WebSocket, message: ServerMessage) -> Result<()> {
    socket.send(Message::Text(serde_json::to_string(&message)?)).await?;
    Ok(())
}

async fn relay(socket: &mut WebSocket, state: &Settings, session: Session) -> Result<()> {
    let first = time::timeout(Duration::from_secs(20), socket.recv()).await?.ok_or_else(|| anyhow::anyhow!("Socket closed"))??;
    let Message::Text(packet) = first else { bail!("Expected a connect packet"); };
    let message: ClientMessage = serde_json::from_str(&packet)?;
    message.validate()?;
    if !matches!(message, ClientMessage::Connect { .. }) { bail!("Expected a connect packet"); }
    if *session.revoked.borrow() || session.expires <= Instant::now() { bail!("Session expired"); }
    let stream = time::timeout(Duration::from_secs(5), UnixStream::connect(&state.broker)).await??;
    let mut wire = Framed::new(stream, codec());
    wire.send(packet.into_bytes().into()).await?;
    let mut revoked = session.revoked.subscribe();
    let expiry = time::sleep_until(time::Instant::from_std(session.expires));
    tokio::pin!(expiry);
    loop {
        if *revoked.borrow() { break; }
        tokio::select! {
            _ = &mut expiry => { break; }
            _ = revoked.changed() => { break; }
            next = socket.recv() => {
                match next {
                    Some(Ok(Message::Text(packet))) => {
                        let message: ClientMessage = serde_json::from_str(&packet)?;
                        message.validate()?;
                        if matches!(message, ClientMessage::Connect { .. }) { bail!("Already connected"); }
                        wire.send(packet.into_bytes().into()).await?;
                        if matches!(message, ClientMessage::Disconnect) { break; }
                    }
                    Some(Ok(Message::Ping(data))) => socket.send(Message::Pong(data)).await?,
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
    fn session_cookie_is_not_javascript_readable_or_sent_outside_terminal() {
        let result = cookie("test", 300, true);
        assert!(result.contains("HttpOnly")); assert!(result.contains("SameSite=Strict"));
        assert!(result.contains("Path=/terminal")); assert!(result.contains("Secure"));
    }

    #[test]
    fn cookie_parser_supports_multiple_cookies() {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, "other=a; strgo_terminal=valid; another=b".parse().unwrap());
        assert_eq!(cookie_value(&headers).as_deref(), Some("valid"));
    }
}
