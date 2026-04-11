use crate::image_util::resize_for_dock;

/// 默认 Dock 图标数据（编译时嵌入，用于恢复）
#[cfg(target_os = "macos")]
pub static DEFAULT_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");

#[cfg(target_os = "macos")]
pub fn set_macos_dock_icon(data: &[u8], fmt: &str, fill_ratio: f64) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{NSData, MainThreadMarker, NSString as NSNSString};

    let mtm = MainThreadMarker::new().ok_or("不在主线程")?;
    let app = NSApplication::sharedApplication(mtm);

    let png_data = if fmt == "svg" {
        let tmp_path = std::env::temp_dir().join("qqr-dock-icon.svg");
        std::fs::write(&tmp_path, data).map_err(|e| format!("写入临时文件失败: {}", e))?;
        let ns_path = NSNSString::from_str(tmp_path.to_str().unwrap_or(""));
        let ns_image = NSImage::initWithContentsOfFile(NSImage::alloc(), &ns_path)
            .ok_or("NSImage 无法加载 SVG 文件")?;
        let tiff = ns_image.TIFFRepresentation()
            .ok_or("无法获取 TIFF 数据")?;
        resize_for_dock(&tiff.to_vec(), fill_ratio)?
    } else {
        resize_for_dock(data, fill_ratio)?
    };

    let ns_data = NSData::with_bytes(&png_data);
    let ns_image = NSImage::initWithData(NSImage::alloc(), &ns_data)
        .ok_or("NSImage 无法创建图片")?;
    unsafe { app.setApplicationIconImage(Some(&ns_image)) };
    Ok(())
}

/// 从目标 URL 获取 favicon 并设置为 macOS Dock 图标
pub async fn set_dock_icon_from_url_inner(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let parsed = url.parse::<url::Url>().map_err(|e| format!("无效的 URL: {}", e))?;
    let origin = parsed.origin().ascii_serialization();

    let (icon_bytes, fmt) = crate::favicon::fetch_favicon(&origin).await?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app = app.clone();
    app.run_on_main_thread(move || {
        let result = set_macos_dock_icon(&icon_bytes, &fmt, 0.8);
        let _ = tx.send(result);
    }).map_err(|e| format!("调度到主线程失败: {}", e))?;

    rx.recv().map_err(|e| format!("等待主线程执行失败: {}", e))?
}

/// 恢复默认 Dock 图标
pub fn reset_dock_icon_inner(app: &tauri::AppHandle) -> Result<(), String> {
    let icon_bytes = DEFAULT_ICON_BYTES.to_vec();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app = app.clone();
    app.run_on_main_thread(move || {
        let result = set_macos_dock_icon(&icon_bytes, "png", 1.0);
        let _ = tx.send(result);
    }).map_err(|e| format!("调度到主线程失败: {}", e))?;

    rx.recv().map_err(|e| format!("等待主线程执行失败: {}", e))?
}

/// 隐藏 Dock 图标（NSApplication.setActivationPolicy(.accessory)）
/// 应用仅在菜单栏显示，不出现在 Dock 中
#[cfg(target_os = "macos")]
pub fn hide_dock_icon() -> Result<(), String> {
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    use objc2_foundation::MainThreadMarker;

    let mtm = MainThreadMarker::new().ok_or("不在主线程")?;
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    Ok(())
}

/// 恢复 Dock 图标（NSApplication.setActivationPolicy(.regular)）
#[cfg(target_os = "macos")]
pub fn show_dock_icon() -> Result<(), String> {
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    use objc2_foundation::MainThreadMarker;

    let mtm = MainThreadMarker::new().ok_or("不在主线程")?;
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    Ok(())
}
