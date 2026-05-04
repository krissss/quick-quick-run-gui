use serde::Deserialize;
use std::collections::HashSet;
use std::sync::MutexGuard;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
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

    let _ = store.reload();
    store
        .get("apps")
        .and_then(|v| serde_json::from_value::<Vec<AppEntry>>(v.clone()).ok())
        .unwrap_or_default()
}

/// 读取当前运行中的应用 ID
fn read_running_ids(app: &AppHandle) -> HashSet<String> {
    use crate::process::AppState;
    crate::process::restore_persisted_sessions(app);
    if let Some(state) = app.try_state::<AppState>() {
        recover_lock(&state.processes).keys().cloned().collect()
    } else {
        HashSet::new()
    }
}

fn app_item_type(app: &AppEntry) -> &str {
    if app.item_type.is_empty() {
        "web"
    } else {
        app.item_type.as_str()
    }
}

fn launch_action_label(app: &AppEntry) -> &'static str {
    if app_item_type(app) == "task" {
        "运行"
    } else {
        "启动"
    }
}

/// 构建托盘菜单
fn build_menu(app: &AppHandle) -> tauri::menu::Menu<tauri::Wry> {
    let all_apps = read_apps_from_store(app);
    let running = read_running_ids(app);

    let mut mb = MenuBuilder::new(app);
    let running_apps: Vec<&AppEntry> = all_apps
        .iter()
        .filter(|a| running.contains(&a.id))
        .collect();
    let stopped_apps: Vec<&AppEntry> = all_apps
        .iter()
        .filter(|a| !running.contains(&a.id))
        .collect();

    if let Ok(item) = MenuItem::with_id(app, "show-main", "显示主窗口", true, None::<&str>) {
        mb = mb.item(&item);
    }

    if !all_apps.is_empty() {
        if let Ok(sep) = PredefinedMenuItem::separator(app) {
            mb = mb.item(&sep);
        }
    }

    let running_windows: Vec<&AppEntry> = running_apps
        .iter()
        .copied()
        .filter(|a| app_item_type(a) == "web")
        .collect();
    if !running_windows.is_empty() {
        let mut submenu = SubmenuBuilder::new(app, "运行中的窗口");
        for a in running_windows {
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("show:{}", a.id),
                format!("打开 {}", a.name),
                true,
                None::<&str>,
            ) {
                submenu = submenu.item(&item);
            }
        }
        if let Ok(menu) = submenu.build() {
            mb = mb.item(&menu);
        }
    }

    let background_items: Vec<&AppEntry> = running_apps
        .iter()
        .copied()
        .filter(|a| app_item_type(a) != "web")
        .collect();
    if !background_items.is_empty() {
        let mut submenu = SubmenuBuilder::new(app, "运行中的服务和任务");
        let item_count = background_items.len();
        for (index, a) in background_items.into_iter().enumerate() {
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("log:{}", a.id),
                format!("查看 {} 日志", a.name),
                true,
                None::<&str>,
            ) {
                submenu = submenu.item(&item);
            }
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("stop:{}", a.id),
                format!("停止 {}", a.name),
                true,
                None::<&str>,
            ) {
                submenu = submenu.item(&item);
            }
            if index + 1 < item_count {
                if let Ok(sep) = PredefinedMenuItem::separator(app) {
                    submenu = submenu.item(&sep);
                }
            }
        }
        if let Ok(menu) = submenu.build() {
            mb = mb.item(&menu);
        }
    }

    if !stopped_apps.is_empty() {
        let mut submenu = SubmenuBuilder::new(app, "启动未运行项");
        for a in &stopped_apps {
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("launch:{}", a.id),
                format!("{} {}", launch_action_label(a), a.name),
                true,
                None::<&str>,
            ) {
                submenu = submenu.item(&item);
            }
        }
        if let Ok(menu) = submenu.build() {
            mb = mb.item(&menu);
        }
    }

    if !running_apps.is_empty() {
        if let Ok(item) = MenuItem::with_id(app, "stop-all", "停止全部运行项", true, None::<&str>)
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
        .tooltip("QQRun")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            if id == "quit" {
                app.exit(0);
            } else if id == "stop-all" {
                crate::process::force_kill_all(app);
                rebuild_tray_menu(app);
            } else if id == "show-main" {
                crate::show_main_window(app);
            } else if let Some(app_id) = id.strip_prefix("show:") {
                let _ = crate::show_or_create_app_window(app, app_id);
            } else if let Some(app_id) = id.strip_prefix("log:") {
                crate::show_main_window(app);
                let _ = app.emit("tray-open-log", app_id.to_string());
            } else if let Some(app_id) = id.strip_prefix("stop:") {
                crate::process::kill_app_process(app, app_id);
                rebuild_tray_menu(app);
            } else if let Some(app_id) = id.strip_prefix("launch:") {
                let _ = app.emit("tray-launch-app", app_id.to_string());
            }
        })
        .build(app);
    if let Err(e) = &_tray {
        eprintln!("创建托盘图标失败: {}", e);
    }
}
