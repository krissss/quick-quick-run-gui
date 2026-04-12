#[cfg(target_os = "macos")]
mod dock;
mod favicon;
mod image_util;
mod process;
mod tray;
mod url_check;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Listener, Manager};

use favicon::{extract_html_title, fetch_favicon};
use process::{
    AppState, ProcessInfo, kill_app_process, spawn_log_reader,
    spawn_process_monitor, spawn_shell_command, window_label_for,
};
use url_check::check_url_inner;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            processes: Mutex::new(std::collections::HashMap::new()),
        })
        .invoke_handler({
            #[cfg(target_os = "macos")]
            {
                tauri::generate_handler![
                    launch_app_window,
                    stop_app_window,
                    get_running_apps,
                    get_app_logs,
                    check_url_reachable,
                    set_window_title_from_url,
                    fetch_favicon_data_url,
                    notify_apps_updated,
                    hide_dock_icon_cmd,
                    show_dock_icon_cmd,
                ]
            }
            #[cfg(not(target_os = "macos"))]
            {
                tauri::generate_handler![
                    launch_app_window,
                    stop_app_window,
                    get_running_apps,
                    get_app_logs,
                    check_url_reachable,
                    set_window_title_from_url,
                    fetch_favicon_data_url,
                    notify_apps_updated,
                ]
            }
        })
        .setup(|app| {
            // 修复 macOS app bundle 环境变量缺失问题
            // 从 Finder/Spotlight 启动时不会继承 shell 的环境（缺少 Homebrew/nvm/pnpm 等路径和变量）
            // fix_all_vars() 通过 interactive login shell 获取完整环境并注入当前进程
            if let Err(e) = fix_path_env::fix_all_vars() {
                eprintln!("fix_path_env failed: {e}");
            }

            // 主窗口关闭时隐藏而非退出（通过托盘菜单"退出"才真正退出）
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.hide();
                        }
                        #[cfg(target_os = "macos")]
                        { let _ = dock::hide_dock_icon(); }
                    }
                });
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
) -> Result<String, String> {
    let window_label = window_label_for(&app_id);

    // 如果窗口已存在，聚焦并返回
    if let Some(existing) = app.get_webview_window(&window_label) {
        let _ = existing.set_focus();
        return Ok("窗口已存在，已聚焦".to_string());
    }

    // 先杀掉同 app_id 的旧进程
    kill_app_process(&app, &app_id);

    let has_command = !command.trim().is_empty();

    if !has_command {
        // 无命令：直接创建窗口
        let logs = Arc::new(Mutex::new(Vec::new()));
        let window_url = build_app_window_url(&url, &app_id);
        let webview_window = tauri::WebviewWindowBuilder::new(
            &app, &window_label, window_url,
        )
        .title(&app_name)
        .inner_size(width, height)
        .background_color(tauri::utils::config::Color(bg_r, bg_g, bg_b, 255))
        .center()
        .build()
        .map_err(|e| format!("创建窗口失败: {}", e))?;

        let app_handle_close = app.clone();
        let app_id_close = app_id.clone();
        webview_window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                || matches!(event, tauri::WindowEvent::Destroyed)
            {
                kill_app_process(&app_handle_close, &app_id_close);
            }
        });

        state.processes.lock().unwrap().insert(
            app_id.clone(),
            ProcessInfo { child: None, logs },
        );
        let _ = app.emit("app-launched", app_id);
        return Ok("窗口已打开".to_string());
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
    state.processes.lock().unwrap().insert(
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
            s.is_some() && s.unwrap().processes.lock().unwrap().contains_key(&app_id_bg)
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
        let window_url = build_app_window_url(&url_bg, &app_id_bg);
        let webview_window = match tauri::WebviewWindowBuilder::new(
            &app_bg, &label, window_url,
        )
        .title(&app_name_bg)
        .inner_size(width, height)
        .background_color(tauri::utils::config::Color(bg_r, bg_g, bg_b, 255))
        .center()
        .build()
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

        let app_h = app_bg.clone();
        let app_id_c = app_id_bg.clone();
        webview_window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                || matches!(event, tauri::WindowEvent::Destroyed)
            {
                kill_app_process(&app_h, &app_id_c);
            }
        });

        // 设置窗口标题
        let label2 = window_label_for(&app_id_bg);
        if let Some(win) = app_bg.get_webview_window(&label2) {
            let _ = set_window_title_inner(&win, &url_bg).await;
        }
    });

    Ok(format!("进程已启动, PID: {}", pid))
}

/// 停止应用并关闭窗口
#[tauri::command]
fn stop_app_window(
    app: tauri::AppHandle,
    app_id: String,
) -> Result<String, String> {
    kill_app_process(&app, &app_id);

    let window_label = window_label_for(&app_id);
    if let Some(window) = app.get_webview_window(&window_label) {
        let _ = window.close();
    }

    Ok("已停止并关闭".to_string())
}

/// 获取当前运行的 app ID 列表
#[tauri::command]
fn get_running_apps(state: tauri::State<'_, AppState>) -> Vec<String> {
    state.processes.lock().unwrap().keys().cloned().collect()
}

/// 获取指定应用的日志缓冲
#[tauri::command]
fn get_app_logs(state: tauri::State<'_, AppState>, app_id: String) -> Vec<String> {
    let processes = state.processes.lock().unwrap();
    if let Some(info) = processes.get(&app_id) {
        info.logs.lock().unwrap().clone()
    } else {
        vec![]
    }
}

/// 检测目标 URL 是否可达
#[tauri::command]
async fn check_url_reachable(url: String, timeout_secs: u64) -> Result<bool, String> {
    Ok(check_url_inner(&url, timeout_secs).await)
}

/// 获取 favicon 并返回 base64 data URL（供前端卡片图标使用）
#[tauri::command]
async fn fetch_favicon_data_url(url: String) -> Result<String, String> {
    let parsed = url.parse::<url::Url>().map_err(|e| format!("无效的 URL: {}", e))?;
    let origin = parsed.origin().ascii_serialization();

    let (icon_bytes, _fmt) = fetch_favicon(&origin).await?;

    let img = image::load_from_memory(&icon_bytes)
        .map_err(|e| format!("解码图片失败: {}", e))?;
    let resized = img.resize(64, 64, image::imageops::FilterType::Lanczos3);

    let mut buf = Vec::new();
    resized.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// 从目标 URL 获取页面标题并设置为窗口标题
#[tauri::command]
async fn set_window_title_from_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    set_window_title_inner(&window, &url).await
}

/// 前端通知应用列表已更新，重建托盘菜单
#[tauri::command]
fn notify_apps_updated(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    tray::rebuild_tray_menu(&app);
}

/// 隐藏 Dock 图标（仅保留菜单栏）
#[cfg(target_os = "macos")]
#[tauri::command]
async fn hide_dock_icon_cmd(app: tauri::AppHandle) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let _ = tx.send(dock::hide_dock_icon());
    }).map_err(|e| format!("调度失败: {}", e))?;
    rx.recv().map_err(|e| format!("执行失败: {}", e))?
}

/// 显示 Dock 图标
#[cfg(target_os = "macos")]
#[tauri::command]
async fn show_dock_icon_cmd(app: tauri::AppHandle) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let _ = tx.send(dock::show_dock_icon());
    }).map_err(|e| format!("调度失败: {}", e))?;
    rx.recv().map_err(|e| format!("执行失败: {}", e))?
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

/// 构建独立窗口加载的 URL
fn build_app_window_url(target_url: &str, app_id: &str) -> tauri::WebviewUrl {
    #[cfg(debug_assertions)]
    {
        let url = format!(
            "http://localhost:5173/app-window.html?url={}&app_id={}",
            urlencoding::encode(target_url),
            urlencoding::encode(app_id),
        );
        tauri::WebviewUrl::External(url.parse().unwrap())
    }
    #[cfg(not(debug_assertions))]
    {
        let path = format!(
            "app-window.html?url={}&app_id={}",
            urlencoding::encode(target_url),
            urlencoding::encode(app_id),
        );
        tauri::WebviewUrl::App(path.into())
    }
}
