use serde::Deserialize;
use std::collections::HashSet;
use std::sync::MutexGuard;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

/// Lock a Mutex, recovering from poison by taking the guard.
fn recover_lock<T>(mutex: &std::sync::Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// 应用配置（对应前端 AppItem）
#[derive(Debug, Deserialize)]
struct AppEntry {
    id: String,
    name: String,
    #[serde(default, rename = "type")]
    item_type: String,
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
        recover_lock(&state.processes).keys().cloned().collect()
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
    let running_apps: Vec<&AppEntry> = all_apps
        .iter()
        .filter(|a| running.contains(&a.id))
        .collect();
    let stopped_apps: Vec<&AppEntry> = all_apps
        .iter()
        .filter(|a| !running.contains(&a.id))
        .collect();

    // 运行中应用（带 ● 标记）
    for a in &running_apps {
        if let Ok(item) = MenuItem::with_id(app, &a.id, format!("● {}", a.name), true, None::<&str>)
        {
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
    if !running_apps.is_empty() {
        if let Ok(item) = MenuItem::with_id(app, "stop-all", "停止所有服务", true, None::<&str>)
        {
            mb = mb.item(&item);
        }
    }
    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        mb = mb.item(&sep);
    }
    if let Ok(item) = MenuItem::with_id(app, "quit", "退出", true, None::<&str>) {
        mb = mb.item(&item);
    }

    mb.build().unwrap_or_else(|e| {
        eprintln!("构建托盘菜单失败: {}", e);
        // 返回空菜单作为 fallback
        MenuBuilder::new(app).build().expect("构建空菜单失败")
    })
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
fn create_template_icon() -> Option<Image<'static>> {
    let bytes = include_bytes!("../icons/tray-icon.png");
    Image::from_bytes(bytes).ok()
}

/// 初始化系统托盘图标
pub fn setup_tray(app: &AppHandle) {
    let icon = match create_template_icon() {
        Some(i) => i,
        None => {
            eprintln!("警告: 加载托盘图标失败，跳过托盘设置");
            return;
        }
    };

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
                    app.exit(0);
                }
                "stop-all" => {
                    crate::process::force_kill_all(app);
                    rebuild_tray_menu(app);
                }
                "show-main" => {
                    #[cfg(target_os = "macos")]
                    {
                        let _ = crate::dock::show_dock_icon();
                    }
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                app_id => {
                    let running = read_running_ids(app);
                    if running.contains(app_id) {
                        let app_entry = read_apps_from_store(app)
                            .into_iter()
                            .find(|item| item.id == app_id);
                        if app_entry
                            .as_ref()
                            .map(|item| item.item_type.as_str())
                            .filter(|item_type| !item_type.is_empty())
                            .unwrap_or("web")
                            == "web"
                        {
                            let _ = crate::show_or_create_app_window(app, app_id);
                        } else if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    } else {
                        let _ = app.emit("tray-launch-app", app_id.to_string());
                    }
                }
            }
        })
        .build(app);
    if let Err(e) = &_tray {
        eprintln!("创建托盘图标失败: {}", e);
    }
}
