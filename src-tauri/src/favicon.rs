use scraper::{Html, Selector};

/// 从 HTML 中提取 <title> 内容
pub fn extract_html_title(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("title").ok()?;
    let title = document.select(&selector).next()?.text().collect::<String>();
    let trimmed = title.trim().to_string();
    if trimmed.is_empty() { return None; }
    Some(trimmed)
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
}
