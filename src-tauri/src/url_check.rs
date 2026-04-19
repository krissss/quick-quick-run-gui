/// 检测目标 URL 是否可达（TCP 轮询，指数退避）
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
    let port = parsed.port().unwrap_or_else(|| {
        if parsed.scheme() == "https" { 443 } else { 80 }
    });

    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    // 指数退避：1s → 2s → 4s → 8s → 15s（最大）
    let mut delay = Duration::from_secs(1);
    let max_delay = Duration::from_secs(15);

    loop {
        let addr = format!("{}:{}", host, port);
        let connect_result = tokio::time::timeout(
            Duration::from_millis(500),
            tokio::net::TcpStream::connect(&addr),
        ).await;

        if connect_result.is_ok() {
            return true;
        }

        if start.elapsed() >= timeout {
            return false;
        }

        // 使用指数退避，但不超过最大延迟
        tokio::time::sleep(delay).await;
        delay = std::cmp::min(delay * 2, max_delay);
    }
}
