mod dock;
mod favicon;
mod image_util;
mod process;
mod url_check;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};
#[cfg(not(debug_assertions))]
use tauri::WebviewUrl;

use dock::{reset_dock_icon_inner, set_dock_icon_from_url_inner};
use favicon::{extract_html_title, fetch_favicon};
use process::{
    AppState, ProcessInfo, force_kill_all, kill_app_process, spawn_log_reader,
    spawn_shell_command, window_label_for,
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
        .invoke_handler(tauri::generate_handler![
            launch_app_window,
            stop_app_window,
            get_running_apps,
            get_app_logs,
            check_url_reachable,
            set_dock_icon_from_url,
            reset_dock_icon,
            set_window_title_from_url,
            fetch_favicon_data_url,
        ])
        .setup(|app| {
            // 启动时设置带 padding 的默认 Dock 图标（和 favicon 统一大小）
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                let icon_bytes = dock::DEFAULT_ICON_BYTES.to_vec();
                let _ = handle.run_on_main_thread(move || {
                    let _ = dock::set_macos_dock_icon(&icon_bytes, "png", 0.8);
                });
            }

            // 主窗口关闭时清理所有子进程
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let h = handle.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        force_kill_all(&h);
                    }
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

    // 日志缓冲
    let logs = Arc::new(Mutex::new(Vec::new()));

    // 启动进程（如果有命令）
    let mut child_opt: Option<command_group::GroupChild> = None;
    let mut result_pid: Option<u32> = None;

    if has_command {
        let (mut child, pid) = spawn_shell_command(&command)?;
        result_pid = Some(pid);

        // 取出 stdout/stderr 用于日志读取
        let stdout = child.inner().stdout.take();
        let stderr = child.inner().stderr.take();

        if let Some(out) = stdout {
            spawn_log_reader(&app, &app_id, out, logs.clone());
        }
        if let Some(err) = stderr {
            spawn_log_reader(&app, &app_id, err, logs.clone());
        }

        child_opt = Some(child);

        // 等待 URL 可达
        let _reachable = check_url_inner(&url, 15).await;
    }

    // 构建独立窗口的 URL
    let window_url = build_app_window_url(&url, &app_id);

    // 创建新窗口
    let webview_window = tauri::WebviewWindowBuilder::new(
        &app,
        &window_label,
        window_url,
    )
    .title(&app_name)
    .inner_size(width, height)
    .background_color(tauri::utils::config::Color(bg_r, bg_g, bg_b, 255))
    .center()
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    // 窗口关闭时杀进程
    let app_handle_close = app.clone();
    let app_id_close = app_id.clone();
    webview_window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. })
            || matches!(event, tauri::WindowEvent::Destroyed)
        {
            kill_app_process(&app_handle_close, &app_id_close);
        }
    });

    // 存入 HashMap
    state.processes.lock().unwrap().insert(
        app_id.clone(),
        ProcessInfo {
            child: child_opt,
            logs,
        },
    );

    let _ = app.emit("app-launched", app_id.clone());

    // 异步设置 dock 图标和窗口标题（不阻塞返回）
    if has_command {
        let app_for_icon = app.clone();
        let url_for_icon = url.clone();
        let app_id_for_title = app_id.clone();
        tokio::spawn(async move {
            let _ = set_dock_icon_from_url_inner(&app_for_icon, &url_for_icon).await;
            let label = window_label_for(&app_id_for_title);
            if let Some(win) = app_for_icon.get_webview_window(&label) {
                let _ = set_window_title_inner(&win, &url_for_icon).await;
            }
        });
        Ok(format!("进程已启动, PID: {}", result_pid.unwrap()))
    } else {
        Ok("窗口已打开".to_string())
    }
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

    // 如果没有其他应用运行，恢复默认 dock 图标
    let should_reset = if let Some(state) = app.try_state::<AppState>() {
        state.processes.lock().unwrap().is_empty()
    } else {
        true
    };
    if should_reset {
        let _ = reset_dock_icon_inner(&app);
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

/// 从目标 URL 获取 favicon 并设置为 macOS Dock 图标
#[tauri::command]
async fn set_dock_icon_from_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    set_dock_icon_from_url_inner(&app, &url).await
}

/// 恢复默认 Dock 图标
#[tauri::command]
fn reset_dock_icon(app: tauri::AppHandle) -> Result<(), String> {
    reset_dock_icon_inner(&app)
}

/// 从目标 URL 获取页面标题并设置为窗口标题
#[tauri::command]
async fn set_window_title_from_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    set_window_title_inner(&window, &url).await
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
fn build_app_window_url(target_url: &str, _app_id: &str) -> tauri::WebviewUrl {
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
