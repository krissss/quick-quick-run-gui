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
