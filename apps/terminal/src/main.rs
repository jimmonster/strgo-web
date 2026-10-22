mod access;
mod broker;
mod protocol;
mod web;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("serve") => web::run().await,
        Some("broker") => broker::run().await,
        _ => anyhow::bail!("Usage: strgo-terminal <serve|broker> (see README.md for configuration)"),
    }
}

mod account;
