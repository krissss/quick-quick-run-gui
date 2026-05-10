use scraper::{Html, Selector};

/// 从 HTML 中提取 <title> 内容
pub fn extract_html_title(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("title").ok()?;
    let title = document
        .select(&selector)
        .next()?
        .text()
        .collect::<String>();
    let trimmed = title.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed)
}

/// 从 HTML 中提取网页图标地址，返回原始 href 值。
pub fn extract_favicon_href(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("link[href]").ok()?;
    let preferred_rels = ["icon", "shortcut icon", "apple-touch-icon", "mask-icon"];

    for preferred in preferred_rels {
        if let Some(href) = document.select(&selector).find_map(|element| {
            let rel = element.value().attr("rel")?.to_ascii_lowercase();
            let rel_tokens: Vec<&str> = rel.split_ascii_whitespace().collect();
            let matches = match preferred {
                "shortcut icon" => rel_tokens.contains(&"shortcut") && rel_tokens.contains(&"icon"),
                _ => rel_tokens.contains(&preferred),
            };
            if !matches {
                return None;
            }
            clean_href(element.value().attr("href")?)
        }) {
            return Some(href);
        }
    }

    None
}

fn clean_href(href: &str) -> Option<String> {
    let trimmed = href.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn favicon_prefers_icon_link() {
        let html = r#"
          <link rel="apple-touch-icon" href="/apple.png">
          <link rel="icon" href="/favicon.png">
        "#;
        assert_eq!(extract_favicon_href(html), Some("/favicon.png".to_string()));
    }

    #[test]
    fn favicon_supports_shortcut_icon() {
        let html = r#"<link rel="shortcut icon" href="/favicon.ico">"#;
        assert_eq!(extract_favicon_href(html), Some("/favicon.ico".to_string()));
    }

    #[test]
    fn favicon_ignores_empty_and_data_urls() {
        assert_eq!(extract_favicon_href(r#"<link rel="icon" href="">"#), None);
        assert_eq!(
            extract_favicon_href(r#"<link rel="icon" href="data:image/png;base64,abc">"#),
            None,
        );
    }
}
