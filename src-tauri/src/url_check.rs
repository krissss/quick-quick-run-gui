/// 检测目标 URL 是否可达（HTTP GET 轮询，指数退避）
pub async fn check_url_inner(url: &str, timeout_secs: u64) -> bool {
    use std::time::Duration;

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    // 指数退避：500ms → 1s → 2s → 4s → 8s（最大）
    let mut delay = Duration::from_millis(500);
    let max_delay = Duration::from_secs(8);

    loop {
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() || resp.status().is_redirection() => {
                return true;
            }
            _ => {}
        }

        if start.elapsed() >= timeout {
            return false;
        }

        tokio::time::sleep(delay).await;
        delay = std::cmp::min(delay * 2, max_delay);
    }
}
