#[cfg(target_os = "macos")]
mod dock;
mod html_title;
mod process;
mod tray;
mod url_check;

use std::sync::{Arc, Mutex, MutexGuard};

use tauri::{Emitter, Listener, Manager};
use tauri_plugin_store::StoreExt;

use html_title::extract_html_title;
use process::{
    AppState, ProcessInfo, kill_app_process, spawn_log_reader,
    spawn_process_monitor, spawn_shell_command, window_label_for,
};
use url_check::check_url_inner;

/// Lock a Mutex, recovering from poison by taking the guard.
fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(AppState {
            processes: Mutex::new(std::collections::HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            launch_app_window,
            get_running_apps,
            get_app_logs,
            stop_app,
            show_app_window,
            notify_apps_updated,
            open_in_browser,
        ])
        .setup(|app| {
            // 修复 macOS app bundle 环境变量缺失问题
            // 从 Finder/Spotlight 启动时不会继承 shell 的环境（缺少 Homebrew/nvm/pnpm 等路径和变量）
            // fix_all_vars() 通过 interactive login shell 获取完整环境并注入当前进程
            if let Err(e) = fix_path_env::fix_all_vars() {
                eprintln!("fix_path_env failed: {e}");
            }

            // 主窗口关闭时保存位置并隐藏
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                let window_clone = window.clone();
                window_clone.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // 保存窗口位置和大小
                        save_window_state(&handle, "main", &window);

                        api.prevent_close();
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.hide();
                        }
                        #[cfg(target_os = "macos")]
                        { let _ = dock::hide_dock_icon(); }
                    }
                });
            }

            // 恢复主窗口保存的位置（逻辑坐标）
            if let Some(window) = app.get_webview_window("main") {
                if let Some(state) = load_window_state(&app.handle(), "main") {
                    let pos = tauri::Position::Logical(tauri::LogicalPosition::new(state.x, state.y));
                    let size = tauri::Size::Logical(tauri::LogicalSize::new(state.width, state.height));
                    let _ = window.set_size(size);
                    let _ = window.set_position(pos);
                }
            }

            // 设置系统托盘（macOS 菜单栏图标）
            #[cfg(target_os = "macos")]
            {
                tray::setup_tray(&app.handle());

                // 监听事件以刷新托盘菜单
                let h1 = app.handle().clone();
                let h2 = app.handle().clone();
                let h3 = app.handle().clone();
                let _ = app.listen("apps-updated", move |_| {
                    tray::rebuild_tray_menu(&h1);
                });
                let _ = app.listen("app-launched", move |_| {
                    tray::rebuild_tray_menu(&h2);
                });
                let _ = app.listen("app-stopped", move |_| {
                    tray::rebuild_tray_menu(&h3);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── IPC 命令 ──

/// launch_app_window 返回值
#[derive(serde::Serialize)]
struct LaunchResult {
    message: String,
    pid: Option<u32>,
}

/// 启动应用并在新窗口中运行
#[tauri::command]
async fn launch_app_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    app_id: String,
    command: String,
    url: String,
    width: f64,
    height: f64,
    app_name: String,
    bg_r: u8,
    bg_g: u8,
    bg_b: u8,
) -> Result<LaunchResult, String> {
    let window_label = window_label_for(&app_id);

    // 如果窗口已存在，取消最小化并聚焦
    if let Some(existing) = app.get_webview_window(&window_label) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(LaunchResult { message: "窗口已存在，已聚焦".into(), pid: None });
    }

    // 先杀掉同 app_id 的旧进程
    kill_app_process(&app, &app_id);

    let has_command = !command.trim().is_empty();

    if !has_command {
        // 无命令：直接创建窗口
        let logs = Arc::new(Mutex::new(Vec::new()));
        let window_url = build_app_window_url(&url);
        let saved_state = load_window_state(&app, &app_id);

        let mut builder = tauri::WebviewWindowBuilder::new(
            &app, &window_label, window_url,
        )
        .title(&app_name)
        .background_color(tauri::utils::config::Color(bg_r, bg_g, bg_b, 255));

        // 恢复保存的位置和大小
        if let Some(state) = saved_state {
            builder = builder
                .inner_size(state.width, state.height)
                .position(state.x, state.y);
        } else {
            builder = builder
                .inner_size(width, height)
                .center();
        }

        let webview_window = builder
            .build()
            .map_err(|e| format!("创建窗口失败: {}", e))?;

        let app_save = app.clone();
        let app_id_save = app_id.clone();
        webview_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(win) = app_save.get_webview_window(&window_label_for(&app_id_save)) {
                    save_window_state(&app_save, &app_id_save, &win);
                    let _ = win.minimize();
                }
            }
        });

        recover_lock(&state.processes).insert(
            app_id.clone(),
            ProcessInfo { child: None, logs },
        );
        let _ = app.emit("app-launched", app_id.clone());
        let _ = app.emit("app-window-opened", app_id);
        return Ok(LaunchResult { message: "窗口已打开".into(), pid: None });
    }

    // 有命令：启动进程，立即返回，后台等待 URL 后创建窗口
    let (mut child, pid) = spawn_shell_command(&command)?;
    let logs = Arc::new(Mutex::new(Vec::new()));

    let stdout = child.inner().stdout.take();
    let stderr = child.inner().stderr.take();
    if let Some(out) = stdout {
        spawn_log_reader(&app, &app_id, out, logs.clone());
    }
    if let Some(err) = stderr {
        spawn_log_reader(&app, &app_id, err, logs.clone());
    }

    // 存入 HashMap + emit，让前端立即看到日志
    recover_lock(&state.processes).insert(
        app_id.clone(),
        ProcessInfo { child: Some(child), logs },
    );
    let _ = app.emit("app-launched", app_id.clone());

    // 启动进程退出监控
    spawn_process_monitor(&app, &app_id);

    // 后台任务：等待 URL 可达 → 创建窗口
    let app_bg = app.clone();
    let app_id_bg = app_id.clone();
    let url_bg = url.clone();
    let app_name_bg = app_name.clone();
    tokio::spawn(async move {
        let reachable = check_url_inner(&url_bg, 15).await;

        // 检查进程是否还在（可能已退出）
        let still_alive = {
            let s = app_bg.try_state::<AppState>();
            s.is_some() && recover_lock(&s.unwrap().processes).contains_key(&app_id_bg)
        };
        if !still_alive {
            return;
        }

        if !reachable {
            let _ = app_bg.emit("app-launch-failed", serde_json::json!({
                "app_id": app_id_bg,
                "reason": "timeout",
            }));
            kill_app_process(&app_bg, &app_id_bg);
            return;
        }

        // 创建窗口
        let label = window_label_for(&app_id_bg);
        let window_url = build_app_window_url(&url_bg);
        let saved_state = load_window_state(&app_bg, &app_id_bg);

        let mut builder = tauri::WebviewWindowBuilder::new(
            &app_bg, &label, window_url,
        )
        .title(&app_name_bg)
        .background_color(tauri::utils::config::Color(bg_r, bg_g, bg_b, 255));

        // 恢复保存的位置和大小
        if let Some(state) = saved_state {
            builder = builder
                .inner_size(state.width, state.height)
                .position(state.x, state.y);
        } else {
            builder = builder
                .inner_size(width, height)
                .center();
        }

        let webview_window = match builder.build()
        {
            Ok(w) => w,
            Err(e) => {
                let _ = app_bg.emit("app-launch-failed", serde_json::json!({
                    "app_id": app_id_bg,
                    "reason": format!("创建窗口失败: {}", e),
                }));
                kill_app_process(&app_bg, &app_id_bg);
                return;
            }
        };

        let app_s = app_bg.clone();
        let app_id_s = app_id_bg.clone();
        let label_s = label.clone();
        webview_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(win) = app_s.get_webview_window(&label_s) {
                    save_window_state(&app_s, &app_id_s, &win);
                    let _ = win.minimize();
                }
            }
        });

        // 设置窗口标题
        let label2 = window_label_for(&app_id_bg);
        if let Some(win) = app_bg.get_webview_window(&label2) {
            let _ = set_window_title_inner(&win, &url_bg).await;
        }

        let _ = app_bg.emit("app-window-opened", app_id_bg);
    });

    Ok(LaunchResult { message: "进程已启动".into(), pid: Some(pid) })
}

/// 获取当前运行的 app ID 列表
#[tauri::command]
fn get_running_apps(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(recover_lock(&state.processes).keys().cloned().collect())
}

/// 获取指定应用的日志缓冲
#[tauri::command]
fn get_app_logs(state: tauri::State<'_, AppState>, app_id: String) -> Result<Vec<String>, String> {
    let processes = recover_lock(&state.processes);
    if let Some(info) = processes.get(&app_id) {
        Ok(recover_lock(&info.logs).clone())
    } else {
        Ok(vec![])
    }
}

/// 停止应用进程（杀掉进程、关闭窗口）
#[tauri::command]
fn stop_app(app: tauri::AppHandle, app_id: String) -> Result<(), String> {
    // 先关闭窗口
    let label = window_label_for(&app_id);
    if let Some(win) = app.get_webview_window(&label) {
        save_window_state(&app, &app_id, &win);
        // 因为 on_window_event 拦截了 CloseRequested，这里需要 destroy 而非 close
        let _ = win.destroy();
    }
    kill_app_process(&app, &app_id);
    Ok(())
}

/// 显示/聚焦已运行应用的窗口（取消最小化）
#[tauri::command]
fn show_app_window(app: tauri::AppHandle, app_id: String) -> Result<(), String> {
    let label = window_label_for(&app_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}

/// 前端通知应用列表已更新，重建托盘菜单
#[tauri::command]
fn notify_apps_updated(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    tray::rebuild_tray_menu(&app);
    Ok(())
}

/// 在系统默认浏览器中打开 URL
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("打开浏览器失败: {}", e))?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("打开浏览器失败: {}", e))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", &url])
        .spawn()
        .map_err(|e| format!("打开浏览器失败: {}", e))?;

    Ok(())
}

// ── 内部辅助 ──

async fn set_window_title_inner(window: &tauri::WebviewWindow, url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client.get(url).send().await.map_err(|e| format!("请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let html = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let title = extract_html_title(&html);

    if let Some(title) = title {
        window.set_title(&title).map_err(|e| format!("设置标题失败: {}", e))?;
    }

    Ok(())
}

/// 窗口位置和大小
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct WindowState {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 保存窗口位置和大小（逻辑坐标，与 builder/restore 一致）
fn save_window_state(app: &tauri::AppHandle, app_id: &str, window: &tauri::WebviewWindow) {
    let key = format!("window_pos:{}", app_id);
    let scale = window.scale_factor().unwrap_or(1.0);
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) {
        let state = WindowState {
            x: pos.x as f64 / scale,
            y: pos.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
        };
        if let Ok(store) = app.store("qqr-store.json") {
            let _ = store.set(&key, serde_json::to_value(state).unwrap());
            let _ = store.save();
        }
    }
}

/// 获取保存的窗口状态
fn load_window_state(app: &tauri::AppHandle, app_id: &str) -> Option<WindowState> {
    let key = format!("window_pos:{}", app_id);
    if let Ok(store) = app.store("qqr-store.json") {
        if let Some(value) = store.get(&key) {
            if let Ok(state) = serde_json::from_value::<WindowState>(value) {
                return Some(state);
            }
        }
    }
    None
}

/// 构建独立窗口加载的 URL
fn build_app_window_url(target_url: &str) -> tauri::WebviewUrl {
    #[cfg(debug_assertions)]
    {
        let url = format!(
            "http://localhost:5173/app-window.html?url={}",
            urlencoding::encode(target_url),
        );
        tauri::WebviewUrl::External(url.parse().unwrap())
    }
    #[cfg(not(debug_assertions))]
    {
        let path = format!(
            "app-window.html?url={}",
            urlencoding::encode(target_url),
        );
        tauri::WebviewUrl::App(path.into())
    }
}
