/// 检测目标 URL 是否可达（TCP 轮询）
pub async fn check_url_inner(url: &str, timeout_secs: u64) -> bool {
    use std::time::Duration;

    let parsed = match url.parse::<url::Url>() {
        Ok(u) => u,
        Err(_) => return false,
    };
    let host = match parsed.host_str() {
        Some(h) => h,
        None => return false,
    };
    let port = parsed.port().unwrap_or(80);

    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    loop {
        let addr = format!("{}:{}", host, port);
        let socket_addr: std::net::SocketAddr = match addr.parse() {
            Ok(a) => a,
            Err(_) => {
                match std::net::ToSocketAddrs::to_socket_addrs(&((host, port))) {
                    Ok(mut addrs) => addrs.next().unwrap_or_else(|| {
                        std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port)
                    }),
                    Err(_) => std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port),
                }
            }
        };
        match std::net::TcpStream::connect_timeout(&socket_addr, Duration::from_millis(500)) {
            Ok(_) => return true,
            Err(_) => {}
        }

        if start.elapsed() >= timeout {
            return false;
        }

        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}
