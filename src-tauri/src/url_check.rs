use std::time::Duration;

/// 检测目标 URL 是否可达（HTTP GET 轮询，指数退避）
pub async fn check_url_inner(url: &str, timeout_secs: u64) -> bool {
    check_url_with_timeout(
        url,
        Duration::from_secs(timeout_secs),
        Duration::from_secs(3),
    )
    .await
}

/// 快速探测目标 URL，适合放在前台启动路径中。
pub async fn check_url_quick(url: &str, timeout: Duration) -> bool {
    if check_url_port_quick(url, timeout.min(Duration::from_millis(150))).await {
        return true;
    }
    check_url_with_timeout(url, timeout, timeout).await
}

async fn check_url_port_quick(url: &str, timeout: Duration) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") || timeout.is_zero() {
        return false;
    }
    let (Some(host), Some(port)) = (parsed.host_str(), parsed.port_or_known_default()) else {
        return false;
    };

    matches!(
        tokio::time::timeout(timeout, tokio::net::TcpStream::connect((host, port))).await,
        Ok(Ok(_))
    )
}

async fn check_url_with_timeout(
    url: &str,
    total_timeout: Duration,
    request_timeout: Duration,
) -> bool {
    if url.trim().is_empty() || total_timeout.is_zero() {
        return false;
    }

    let client = match reqwest::Client::builder()
        .timeout(request_timeout.min(total_timeout))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let start = std::time::Instant::now();

    // 指数退避：500ms → 1s → 2s → 4s → 8s（最大）
    let mut delay = Duration::from_millis(500);
    let max_delay = Duration::from_secs(8);

    loop {
        let remaining = total_timeout.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return false;
        }

        match tokio::time::timeout(remaining, client.get(url).send()).await {
            Ok(Ok(resp)) if resp.status().is_success() || resp.status().is_redirection() => {
                return true;
            }
            _ => {}
        }

        if start.elapsed() >= total_timeout {
            return false;
        }

        tokio::time::sleep(delay.min(total_timeout.saturating_sub(start.elapsed()))).await;
        delay = std::cmp::min(delay * 2, max_delay);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn quick_check_accepts_open_tcp_port_without_http_response() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("read listener address");
        let accept = tokio::spawn(async move {
            let _ = listener.accept().await;
        });

        assert!(check_url_quick(&format!("http://{addr}"), Duration::from_millis(200)).await);
        let _ = accept.await;
    }
}
