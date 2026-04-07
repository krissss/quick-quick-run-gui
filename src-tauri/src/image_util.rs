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

/// 将图片缩放并居中到 512x512 画布。fill_ratio 控制图标占画布比例（1.0=填满，0.80=80%）。
pub fn resize_for_dock(data: &[u8], fill_ratio: f64) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(data)
        .map_err(|e| format!("解码图片失败: {}", e))?;

    let canvas_size: u32 = 512;
    let icon_max = if fill_ratio < 1.0 {
        (canvas_size as f64 * fill_ratio).round() as u32
    } else {
        canvas_size
    };
    let padding = (canvas_size - icon_max) / 2;

    let (w, h) = (img.width(), img.height());
    let scale = icon_max as f32 / w.max(h) as f32;
    let new_w = (w as f32 * scale).round() as u32;
    let new_h = (h as f32 * scale).round() as u32;
    let resized = img.resize(new_w, new_h, image::imageops::FilterType::Lanczos3);

    let mut canvas = image::RgbaImage::new(canvas_size, canvas_size);
    let x = (padding + (icon_max - new_w) / 2) as i64;
    let y = (padding + (icon_max - new_h) / 2) as i64;
    image::imageops::overlay(&mut canvas, &resized, x, y);

    let mut buf = Vec::new();
    canvas.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, Rgba, RgbaImage};

    fn make_png(width: u32, height: u32) -> Vec<u8> {
        let img = RgbaImage::from_pixel(width, height, Rgba([255, 0, 0, 255]));
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).unwrap();
        buf
    }

    // ── detect_image_format ──

    #[test]
    fn detect_png() {
        assert_eq!(detect_image_format(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Some("png".into()));
    }

    #[test]
    fn detect_jpeg() {
        assert_eq!(detect_image_format(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpeg".into()));
    }

    #[test]
    fn detect_ico() {
        assert_eq!(detect_image_format(&[0x00, 0x00, 0x01, 0x00]), Some("ico".into()));
    }

    #[test]
    fn detect_svg() {
        let data = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert_eq!(detect_image_format(data), Some("svg".into()));
    }

    #[test]
    fn detect_gif() {
        assert_eq!(detect_image_format(b"GIF89a\x00\x00"), Some("gif".into()));
    }

    #[test]
    fn detect_webp() {
        let mut data = vec![0u8; 12];
        data[0..4].copy_from_slice(b"RIFF");
        data[8..12].copy_from_slice(b"WEBP");
        assert_eq!(detect_image_format(&data), Some("webp".into()));
    }

    #[test]
    fn detect_too_short() {
        assert_eq!(detect_image_format(&[0x00, 0x01, 0x02]), None);
    }

    #[test]
    fn detect_empty() {
        assert_eq!(detect_image_format(&[]), None);
    }

    #[test]
    fn detect_unknown() {
        assert_eq!(detect_image_format(&[0xDE, 0xAD, 0xBE, 0xEF]), None);
    }

    // ── resize_for_dock ──

    #[test]
    fn resize_fill_ratio_less_than_1() {
        let png = make_png(100, 100);
        let result = resize_for_dock(&png, 0.8);
        assert!(result.is_ok());
        let output = result.unwrap();
        // 应该是合法 PNG
        assert!(output.starts_with(&[0x89, 0x50, 0x4E, 0x47]));
    }

    #[test]
    fn resize_fill_ratio_1() {
        let png = make_png(100, 100);
        let result = resize_for_dock(&png, 1.0);
        assert!(result.is_ok());
    }

    #[test]
    fn resize_non_square_image() {
        let png = make_png(200, 100);
        let result = resize_for_dock(&png, 0.8);
        assert!(result.is_ok());
    }

    #[test]
    fn resize_invalid_data() {
        let result = resize_for_dock(&[0xDE, 0xAD, 0xBE, 0xEF], 0.8);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("解码图片失败"));
    }

    #[test]
    fn resize_output_is_512x512() {
        let png = make_png(64, 64);
        let output = resize_for_dock(&png, 1.0).unwrap();
        let img = image::load_from_memory(&output).unwrap();
        assert_eq!(img.width(), 512);
        assert_eq!(img.height(), 512);
    }

    #[test]
    fn resize_with_padding_centered() {
        // 100x100 红色图片，fill_ratio=0.5 → 图标区 256px，padding 128px
        let png = make_png(100, 100);
        let output = resize_for_dock(&png, 0.5).unwrap();
        let img = image::load_from_memory(&output).unwrap();
        // 角落应该是透明（padding 区域），中心应该是红色
        let corner = img.get_pixel(0, 0);
        assert_eq!(corner.0[3], 0, "左上角应为透明");
        let center = img.get_pixel(256, 256);
        assert_eq!(center.0[0], 255, "中心应为红色");
    }
}
