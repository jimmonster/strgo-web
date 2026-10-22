use anyhow::{bail, Result};
use axum::http::{header, HeaderMap};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpStream, time};

pub const COOKIE: &str = "strgo_account_session";

#[derive(Clone, Deserialize, Serialize)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub role: String,
}

#[derive(Deserialize)]
struct Identity { user: Account }

pub fn cookie(headers: &HeaderMap) -> Option<String> {
    let values: Vec<_> = headers.get_all(header::COOKIE).iter().filter_map(|h| h.to_str().ok())
        .flat_map(|h| h.split(';')).filter_map(|h| h.trim().split_once('='))
        .filter(|(name, _)| *name == COOKIE).collect();
    if values.len() != 1 { return None; }
    let token = values[0].1;
    if token.len() < 32 || token.len() > 128 || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b)) { return None; }
    Some(format!("{COOKIE}={token}"))
}

pub async fn verify(address: SocketAddr, cookie: &str) -> Result<Option<Account>> {
    if !address.ip().is_loopback() { bail!("Account service must use loopback"); }
    if cookie.bytes().any(|c| c < 32 || c == 127) { bail!("Invalid account cookie"); }
    time::timeout(Duration::from_secs(3), async {
        let mut stream = TcpStream::connect(address).await?;
        // This fixed local endpoint sends Content-Length and closes the socket.
        // Use httparse for framing rather than interpreting HTTP with splitting.
        stream.write_all(format!("GET /api/image/terminal-session HTTP/1.1\r\nHost: {address}\r\nCookie: {cookie}\r\nConnection: close\r\n\r\n").as_bytes()).await?;
        let mut response = Vec::new();
        stream.take(8193).read_to_end(&mut response).await?;
        parse_identity(&response)
    }).await?
}

fn parse_identity(bytes: &[u8]) -> Result<Option<Account>> {
    if bytes.len() > 8192 { bail!("Account response too large"); }
    let mut headers = [httparse::EMPTY_HEADER; 32];
    let mut response = httparse::Response::new(&mut headers);
    let httparse::Status::Complete(offset) = response.parse(bytes)? else { bail!("Incomplete account response"); };
    if response.code == Some(401) { return Ok(None); }
    if response.code != Some(200) { bail!("Account service unavailable"); }
    if response.headers.iter().any(|h| h.name.eq_ignore_ascii_case("transfer-encoding")) { bail!("Unexpected account framing"); }
    let lengths: Vec<_> = response.headers.iter().filter(|h| h.name.eq_ignore_ascii_case("content-length")).collect();
    if lengths.len() != 1 || std::str::from_utf8(lengths[0].value)?.parse::<usize>()? != bytes.len() - offset { bail!("Incomplete account body"); }
    let identity: Identity = serde_json::from_slice(&bytes[offset..])?;
    if !valid_owner(&identity.user.id) || !matches!(identity.user.role.as_str(), "member" | "admin") { bail!("Invalid account identity"); }
    Ok(Some(identity.user))
}

pub fn valid_owner(owner: &str) -> bool {
    owner.len() == 32 && owner.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_valid_shared_cookie_is_forwarded() {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, format!("other=secret; {COOKIE}={}", "a".repeat(54)).parse().unwrap());
        assert_eq!(cookie(&headers).unwrap(), format!("{COOKIE}={}", "a".repeat(54)));
        headers.append(header::COOKIE, format!("{COOKIE}={}", "b".repeat(54)).parse().unwrap());
        assert!(cookie(&headers).is_none());
        headers.clear();
        headers.insert(header::COOKIE, "strgo_terminal=old-access-token".parse().unwrap());
        assert!(cookie(&headers).is_none());
    }

    #[test]
    fn account_id_cannot_select_a_host_path_or_volume() {
        assert!(valid_owner("0123456789abcdef0123456789abcdef"));
        for owner in ["../root", "", "--mount=/", "0123456789ABCDEF0123456789ABCDEF"] {
            assert!(!valid_owner(owner));
        }
    }

    #[test]
    fn account_http_response_is_bounded_and_fails_closed() {
        let body = r#"{"user":{"id":"0123456789abcdef0123456789abcdef","username":"owner","role":"member"}}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        assert_eq!(parse_identity(response.as_bytes()).unwrap().unwrap().username, "owner");
        assert!(parse_identity(b"HTTP/1.1 401 Unauthorized\r\n\r\n").unwrap().is_none());
        assert!(parse_identity(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{}").is_err());
        assert!(parse_identity(&vec![b'a'; 8193]).is_err());
        assert!(parse_identity(b"HTTP/1.1 500 Error\r\n\r\n").is_err());
    }
}
