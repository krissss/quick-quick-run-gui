/// 检测图片数据的格式（基于 image crate 的 magic bytes 检测，额外支持 SVG）
pub fn detect_image_format(data: &[u8]) -> Option<String> {
    // SVG 不是位图格式，image crate 不支持，手动检测
    let head = String::from_utf8_lossy(&data[..data.len().min(100)]);
    if head.contains("<svg") { return Some("svg".to_string()); }

    let fmt = image::ImageReader::new(std::io::Cursor::new(data))
        .with_guessed_format().ok()?
        .format()?;

    Some(match fmt {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpeg",
        image::ImageFormat::Ico => "ico",
        image::ImageFormat::Gif => "gif",
        image::ImageFormat::WebP => "webp",
        _ => return None,
    }.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_png() {
        assert_eq!(detect_image_format(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Some("png".into()));
    }

    #[test]
    fn detect_jpeg() {
        assert_eq!(detect_image_format(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpeg".into()));
    }

    #[test]
    fn detect_svg() {
        let data = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert_eq!(detect_image_format(data), Some("svg".into()));
    }
}
