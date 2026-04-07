use scraper::{Html, Selector};

use crate::image_util::detect_image_format;

/// 从 HTML 中提取 <title> 内容
pub fn extract_html_title(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("title").ok()?;
    let title = document.select(&selector).next()?.text().collect::<String>();
    let trimmed = title.trim().to_string();
    if trimmed.is_empty() { return None; }
    Some(trimmed)
}

/// 从 HTML 中提取 favicon link 标签信息，按优先级排序
pub fn extract_icons_from_html(html: &str) -> Vec<(String, String)> {
    let document = Html::parse_document(html);
    let Ok(selector) = Selector::parse("link[rel*='icon' i], link[rel*='shortcut' i]") else {
        return Vec::new();
    };

    let mut results = Vec::new();
    for element in document.select(&selector) {
        let rel = element.value().attr("rel").unwrap_or("").to_lowercase();
        let href = match element.value().attr("href") {
            Some(h) => h.to_string(),
            None => continue,
        };
        let type_attr = element.value().attr("type");

        let is_icon = rel.contains("icon") || rel.contains("shortcut");
        if !is_icon { continue; }

        let fmt = if type_attr == Some("image/svg+xml") || href.ends_with(".svg") {
            "svg".to_string()
        } else if href.ends_with(".png") || type_attr == Some("image/png") {
            "png".to_string()
        } else {
            "ico".to_string()
        };
        let priority = rel.contains("apple-touch");
        results.push((href, fmt, priority));
    }
    results.sort_by(|a, b| b.2.cmp(&a.2));
    results.into_iter().map(|(h, f, _)| (h, f)).collect()
}

/// 从目标站点获取 favicon
pub async fn fetch_favicon(origin: &str) -> Result<(Vec<u8>, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let candidates: Vec<&str> = vec![
        "/apple-touch-icon.png",
        "/favicon.ico",
        "/favicon-32x32.png",
        "/favicon-16x16.png",
    ];

    for path in &candidates {
        if let Some(bytes) = fetch_icon_url(&client, origin, path).await {
            if let Some(detected) = detect_image_format(&bytes) {
                return Ok((bytes, detected));
            }
        }
    }

    let html_url = format!("{}/", origin);
    if let Ok(resp) = client.get(&html_url).send().await {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                let icons = extract_icons_from_html(&html);
                for (href, _) in &icons {
                    if let Some(bytes) = fetch_icon_url(&client, origin, href).await {
                        if let Some(detected) = detect_image_format(&bytes) {
                            return Ok((bytes, detected));
                        }
                    }
                }
            }
        }
    }

    Err("未能获取到 favicon".to_string())
}

/// 请求单个 icon URL，返回二进制数据
pub async fn fetch_icon_url(client: &reqwest::Client, origin: &str, path: &str) -> Option<Vec<u8>> {
    let full_url = if path.starts_with("http") {
        path.to_string()
    } else if path.starts_with("//") {
        format!("https:{}", path)
    } else if path.starts_with('/') {
        format!("{}{}", origin, path)
    } else {
        format!("{}/{}", origin, path)
    };
    let resp = client.get(&full_url).send().await.ok()?;
    if !resp.status().is_success() { return None; }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() { return None; }
    Some(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_html_title ──

    #[test]
    fn title_normal() {
        let html = "<html><head><title>My App</title></head></html>";
        assert_eq!(extract_html_title(html), Some("My App".to_string()));
    }

    #[test]
    fn title_case_insensitive() {
        let html = "<HTML><HEAD><TITLE>My App</TITLE></HEAD></HTML>";
        assert_eq!(extract_html_title(html), Some("My App".to_string()));
    }

    #[test]
    fn title_with_whitespace() {
        let html = "<title>  Hello World  </title>";
        assert_eq!(extract_html_title(html), Some("Hello World".to_string()));
    }

    #[test]
    fn title_empty() {
        let html = "<title></title>";
        assert_eq!(extract_html_title(html), None);
    }

    #[test]
    fn title_whitespace_only() {
        let html = "<title>   </title>";
        assert_eq!(extract_html_title(html), None);
    }

    #[test]
    fn title_no_tag() {
        let html = "<html><body>No title here</body></html>";
        assert_eq!(extract_html_title(html), None);
    }

    #[test]
    fn title_chinese() {
        let html = "<title>我的应用</title>";
        assert_eq!(extract_html_title(html), Some("我的应用".to_string()));
    }

    // ── extract_icons_from_html ──

    #[test]
    fn icons_no_link_tags() {
        assert_eq!(extract_icons_from_html("<html><body></body></html>"), Vec::<(String, String)>::new());
    }

    #[test]
    fn icons_link_with_icon_rel() {
        let html = "<link rel=\"icon\" href=\"/favicon.ico\" type=\"image/x-icon\">";
        let icons = extract_icons_from_html(html);
        assert_eq!(icons.len(), 1);
        assert_eq!(icons[0].0, "/favicon.ico");
        assert_eq!(icons[0].1, "ico");
    }

    #[test]
    fn icons_link_with_shortcut_rel() {
        let html = "<link rel=\"shortcut icon\" href=\"/favicon.ico\">";
        let icons = extract_icons_from_html(html);
        assert_eq!(icons.len(), 1);
        assert_eq!(icons[0].0, "/favicon.ico");
    }

    #[test]
    fn icons_apple_touch_icon_higher_priority() {
        let html = r#"
            <link rel="icon" href="/favicon.png" type="image/png">
            <link rel="apple-touch-icon" href="/apple-icon.png">
        "#;
        let icons = extract_icons_from_html(html);
        assert_eq!(icons.len(), 2);
        assert_eq!(icons[0].0, "/apple-icon.png");
    }

    #[test]
    fn icons_svg_detection() {
        let html = "<link rel=\"icon\" href=\"/icon.svg\" type=\"image/svg+xml\">";
        let icons = extract_icons_from_html(html);
        assert_eq!(icons[0].1, "svg");
    }

    #[test]
    fn icons_png_by_extension() {
        let html = "<link rel=\"icon\" href=\"/icon.png\">";
        let icons = extract_icons_from_html(html);
        assert_eq!(icons[0].1, "png");
    }

    #[test]
    fn icons_skip_non_icon_links() {
        let html = "<link rel=\"stylesheet\" href=\"/style.css\">";
        let icons = extract_icons_from_html(html);
        assert!(icons.is_empty());
    }

    #[test]
    fn icons_uppercase_rel() {
        let html = r#"<link rel="ICON" href="/favicon.ico">"#;
        let icons = extract_icons_from_html(html);
        assert_eq!(icons.len(), 1);
        assert_eq!(icons[0].0, "/favicon.ico");
    }

    #[test]
    fn icons_missing_href_skipped() {
        let html = "<link rel=\"icon\" type=\"image/png\">";
        let icons = extract_icons_from_html(html);
        assert!(icons.is_empty());
    }
}
