use crate::protocol::{allowed_ip, canonical_ip};
use anyhow::{bail, Context, Result};
use std::{collections::HashSet, net::{IpAddr, SocketAddr}};

/// Administrator-managed exceptions apply to one IP and one SSH port.
/// Loopback, metadata, link-local and reserved addresses remain unavailable.
pub struct AccessPolicy {
    allow_private: bool,
    blocked: HashSet<IpAddr>,
    allowed: HashSet<SocketAddr>,
}

impl AccessPolicy {
    pub fn new(allow_private: bool, blocked: &str, allowed: &str) -> Result<Self> {
        let blocked = blocked.split(',').filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().parse::<IpAddr>().map(canonical_ip))
            .collect::<Result<HashSet<_>, _>>().context("TERMINAL_BLOCKED_IPS must contain IP addresses")?;
        let mut endpoints = HashSet::new();
        for value in allowed.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let endpoint: SocketAddr = value.parse().context("TERMINAL_ALLOWED_TARGETS requires IP:port or [IPv6]:port")?;
            let ip = canonical_ip(endpoint.ip());
            if endpoint.port() == 0 || !allowed_ip(ip, true) {
                bail!("Invalid or permanently restricted SSH exception: {value}");
            }
            endpoints.insert(SocketAddr::new(ip, endpoint.port()));
        }
        Ok(Self { allow_private, blocked, allowed: endpoints })
    }

    fn rejection(&self, ip: IpAddr, port: u16) -> Option<&'static str> {
        let ip = canonical_ip(ip);
        if !allowed_ip(ip, true) {
            return Some("禁止访问此特殊地址（回环、链路本地、云元数据或保留地址）");
        }
        if self.allowed.contains(&SocketAddr::new(ip, port)) { return None; }
        if self.blocked.contains(&ip) {
            return Some("被本站地址保护规则拦截，需要管理员放行该 SSH 地址和端口");
        }
        if !allowed_ip(ip, self.allow_private) {
            return Some("内网 SSH 地址尚未放行，需要管理员放行该 SSH 地址和端口");
        }
        None
    }

    pub fn select(&self, addresses: &[IpAddr], port: u16) -> Result<IpAddr> {
        // Only a validated numeric address is passed to SSH, so rejected DNS records
        // cannot be selected by SSH's own resolver.
        let permitted: Vec<_> = addresses.iter().copied().map(canonical_ip)
            .filter(|ip| self.rejection(*ip, port).is_none()).collect();
        if let Some(ip) = permitted.iter().copied().find(IpAddr::is_ipv4).or_else(|| permitted.first().copied()) {
            return Ok(ip);
        }
        if addresses.is_empty() { bail!("服务器没有可用的 IP 地址"); }
        let mut explanations: Vec<_> = addresses.iter().map(|ip| {
            let ip = canonical_ip(*ip);
            format!("{}：{}", SocketAddr::new(ip, port), self.rejection(ip, port).unwrap_or("不允许此目标"))
        }).collect();
        explanations.sort();
        explanations.dedup();
        bail!("{}", explanations.join("；"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ip(value: &str) -> IpAddr { value.parse().unwrap() }

    #[test]
    fn same_server_public_ip_can_be_allowed_for_exactly_one_ssh_port() {
        let policy = AccessPolicy::new(false, "47.108.255.179", "47.108.255.179:22").unwrap();
        assert_eq!(policy.select(&[ip("47.108.255.179")], 22).unwrap(), ip("47.108.255.179"));
        let error = policy.select(&[ip("47.108.255.179")], 2222).unwrap_err().to_string();
        assert!(error.contains("47.108.255.179:2222") && error.contains("本站地址保护"));
    }

    #[test]
    fn one_private_target_does_not_enable_the_entire_private_network() {
        let policy = AccessPolicy::new(false, "10.0.0.1", "10.0.0.1:2222").unwrap();
        assert!(policy.select(&[ip("10.0.0.1")], 2222).is_ok());
        assert!(policy.select(&[ip("10.0.0.1")], 22).is_err());
        assert!(policy.select(&[ip("10.0.0.2")], 2222).is_err());
    }

    #[test]
    fn metadata_loopback_and_special_addresses_cannot_be_exempted() {
        for value in ["127.0.0.1:22", "169.254.169.254:22", "0.0.0.0:22", "224.0.0.1:22", "100.64.0.1:22", "[::1]:22", "[fe80::1]:22", "[::ffff:127.0.0.1]:22"] {
            assert!(AccessPolicy::new(true, "", value).is_err(), "{value}");
        }
        let policy = AccessPolicy::new(true, "", "").unwrap();
        for value in ["127.0.0.1", "169.254.169.254", "::1"] {
            assert!(policy.select(&[ip(value)], 22).unwrap_err().to_string().contains("禁止访问"));
        }
    }

    #[test]
    fn ipv4_mapped_addresses_do_not_bypass_blocking_or_lose_exceptions() {
        let blocked = AccessPolicy::new(false, "::ffff:47.108.255.179", "").unwrap();
        assert!(blocked.select(&[ip("47.108.255.179")], 22).is_err());
        let allowed = AccessPolicy::new(false, "47.108.255.179", "[::ffff:47.108.255.179]:22").unwrap();
        assert_eq!(allowed.select(&[ip("::ffff:47.108.255.179")], 22).unwrap(), ip("47.108.255.179"));
    }

    #[test]
    fn ipv6_exception_is_limited_to_its_ssh_port() {
        let policy = AccessPolicy::new(false, "fc00::2", "[fc00::2]:22").unwrap();
        assert!(policy.select(&[ip("fc00::2")], 22).is_ok());
        assert!(policy.select(&[ip("fc00::2")], 23).is_err());
    }

    #[test]
    fn rejected_dns_records_are_never_passed_to_ssh_when_a_valid_record_exists() {
        let policy = AccessPolicy::new(false, "47.108.255.179", "").unwrap();
        assert_eq!(policy.select(&[ip("10.0.0.1"), ip("47.108.255.179"), ip("8.8.8.8")], 22).unwrap(), ip("8.8.8.8"));
        assert!(policy.select(&[ip("10.0.0.1"), ip("47.108.255.179")], 22).is_err());
    }

    #[test]
    fn malformed_or_hostname_exceptions_do_not_relax_the_policy() {
        for value in ["strgo.com:22", "47.108.255.179", "47.108.255.179:0", "47.108.255.179:*", "-oProxyCommand=sh", "47.108.255.179:65536"] {
            assert!(AccessPolicy::new(false, "", value).is_err());
        }
        assert!(AccessPolicy::new(false, "", " , ").is_ok());
    }
}
