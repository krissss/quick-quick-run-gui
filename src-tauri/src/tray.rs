use serde::Deserialize;
use std::collections::HashSet;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

/// 应用配置（对应前端 AppItem）
#[derive(Debug, Deserialize)]
struct AppEntry {
    id: String,
    name: String,
}

/// 从 tauri-plugin-store 读取应用列表
fn read_apps_from_store(app: &AppHandle) -> Vec<AppEntry> {
    use tauri_plugin_store::StoreExt;

    let store = match app.store("qqr-store.json") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    store
        .get("apps")
        .and_then(|v| serde_json::from_value::<Vec<AppEntry>>(v.clone()).ok())
        .unwrap_or_default()
}

/// 读取当前运行中的应用 ID
fn read_running_ids(app: &AppHandle) -> HashSet<String> {
    use crate::process::AppState;
    if let Some(state) = app.try_state::<AppState>() {
        state.processes.lock().unwrap().keys().cloned().collect()
    } else {
        HashSet::new()
    }
}

/// 构建托盘菜单
fn build_menu(app: &AppHandle) -> tauri::menu::Menu<tauri::Wry> {
    let all_apps = read_apps_from_store(app);
    let running = read_running_ids(app);

    let mut mb = MenuBuilder::new(app);

    // 分组：运行中 / 未运行
    let running_apps: Vec<&AppEntry> = all_apps.iter().filter(|a| running.contains(&a.id)).collect();
    let stopped_apps: Vec<&AppEntry> = all_apps.iter().filter(|a| !running.contains(&a.id)).collect();

    // 运行中应用（带 ● 标记）
    for a in &running_apps {
        if let Ok(item) = MenuItem::with_id(app, &a.id, format!("● {}", a.name), true, None::<&str>) {
            mb = mb.item(&item);
        }
    }

    if !running_apps.is_empty() && !stopped_apps.is_empty() {
        if let Ok(sep) = PredefinedMenuItem::separator(app) {
            mb = mb.item(&sep);
        }
    }

    // 未运行应用
    for a in &stopped_apps {
        if let Ok(item) = MenuItem::with_id(app, &a.id, &a.name, true, None::<&str>) {
            mb = mb.item(&item);
        }
    }

    if !all_apps.is_empty() {
        if let Ok(sep) = PredefinedMenuItem::separator(app) {
            mb = mb.item(&sep);
        }
    }

    if let Ok(item) = MenuItem::with_id(app, "show-main", "显示主窗口", true, None::<&str>) {
        mb = mb.item(&item);
    }
    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        mb = mb.item(&sep);
    }
    if let Ok(item) = MenuItem::with_id(app, "quit", "退出", true, None::<&str>) {
        mb = mb.item(&item);
    }

    mb.build().expect("构建菜单失败")
}

/// 重建托盘菜单（应用列表变化时调用）
pub fn rebuild_tray_menu(app: &AppHandle) {
    let tray = match app.tray_by_id("main-tray") {
        Some(t) => t,
        None => return,
    };

    let menu = build_menu(app);
    let _ = tray.set_menu(Some(menu));
}

/// 加载菜单栏模板图标（黑色双箭头 » 轮廓）
fn create_template_icon() -> Image<'static> {
    let bytes = include_bytes!("../icons/tray-icon.png");
    Image::from_bytes(bytes).expect("加载托盘图标失败")
}

/// 初始化系统托盘图标
pub fn setup_tray(app: &AppHandle) {
    let icon = create_template_icon();

    let menu = build_menu(app);

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Quick Quick Run GUI")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => {
                    crate::process::force_kill_all(app);
                    app.exit(0);
                }
                "show-main" => {
                    #[cfg(target_os = "macos")]
                    { let _ = crate::dock::show_dock_icon(); }
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                app_id => {
                    let running = read_running_ids(app);
                    if running.contains(app_id) {
                        let label = crate::process::window_label_for(app_id);
                        if let Some(win) = app.get_webview_window(&label) {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    } else {
                        let _ = app.emit("tray-launch-app", app_id.to_string());
                    }
                }
            }
        })
        .build(app)
        .expect("创建托盘图标失败");
}
