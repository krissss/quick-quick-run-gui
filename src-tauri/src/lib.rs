use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
#[cfg(not(target_os = "windows"))]
use std::os::unix::process::CommandExt;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[cfg(not(debug_assertions))]
use tauri::WebviewUrl;

/// 默认 Dock 图标数据（编译时嵌入，用于恢复）
#[cfg(target_os = "macos")]
static DEFAULT_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");

/// 每个正在运行的应用进程信息
pub struct ProcessInfo {
    pub child: Child,
    #[cfg(not(target_os = "windows"))]
    pub pgid: u32,
}

/// 全局进程状态，支持多个应用同时运行
pub struct AppState {
    pub processes: Mutex<HashMap<String, ProcessInfo>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            processes: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            launch_app_window,
            stop_app_window,
            get_running_apps,
            check_url_reachable,
            set_dock_icon_from_url,
            reset_dock_icon,
            set_window_title_from_url,
            fetch_favicon_data_url,
        ])
        .setup(|app| {
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

// ── 进程管理辅助函数 ──

/// 杀掉指定 app_id 的进程
fn kill_app_process(handle: &tauri::AppHandle, app_id: &str) {
    if let Some(state) = handle.try_state::<AppState>() {
        let info = {
            let mut processes = state.processes.lock().unwrap();
            processes.remove(app_id)
        };
        if let Some(mut info) = info {
            #[cfg(not(target_os = "windows"))]
            {
                unsafe { libc::killpg(info.pgid as i32, libc::SIGTERM); }
                std::thread::sleep(std::time::Duration::from_millis(200));
                unsafe { libc::killpg(info.pgid as i32, libc::SIGKILL); }
            }
            let _ = info.child.kill();
        }
    }
    let _ = handle.emit("app-stopped", app_id.to_string());
}

/// 强制杀掉所有子进程
fn force_kill_all(handle: &tauri::AppHandle) {
    let infos: Vec<ProcessInfo> = {
        if let Some(state) = handle.try_state::<AppState>() {
            let mut processes = state.processes.lock().unwrap();
            processes.drain().map(|(_, v)| v).collect()
        } else {
            return;
        }
    };
    for mut info in infos {
        #[cfg(not(target_os = "windows"))]
        {
            unsafe { libc::killpg(info.pgid as i32, libc::SIGTERM); }
        }
        let _ = info.child.kill();
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
}

/// 启动 shell 进程，返回 (Child, pid)
fn spawn_shell_command(command: &str) -> Result<(Child, u32), String> {
    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    let child = unsafe {
        Command::new("sh")
            .arg("-c")
            .arg(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .pre_exec(|| {
                libc::setsid();
                Ok(())
            })
            .spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?
    };

    #[cfg(target_os = "windows")]
    let child = Command::new("cmd")
        .args(["/C", command])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x00000200) // CREATE_NEW_PROCESS_GROUP
        .spawn()
        .map_err(|e| format!("启动命令失败: {}", e))?;

    let pid = child.id();
    Ok((child, pid))
}

/// 生成窗口标签：app-{app_id 前 8 字符}
fn window_label_for(app_id: &str) -> String {
    let short = &app_id[..app_id.len().min(8)];
    format!("app-{}", short)
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

    // 启动 shell 进程
    let (child, pid) = spawn_shell_command(&command)?;

    #[cfg(not(target_os = "windows"))]
    let pgid = pid;

    // 等待 URL 可达
    let _reachable = check_url_inner(&url, 15).await;

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
            child,
            #[cfg(not(target_os = "windows"))]
            pgid,
        },
    );

    let _ = app.emit("app-launched", app_id.clone());

    // 异步设置 dock 图标和窗口标题（不阻塞返回）
    let app_for_icon = app.clone();
    let url_for_icon = url.clone();
    let app_id_for_title = app_id.clone();
    tokio::spawn(async move {
        // 设置 dock 图标
        let _ = set_dock_icon_from_url_inner(&app_for_icon, &url_for_icon).await;

        // 设置窗口标题（从页面 <title> 获取）
        let label = window_label_for(&app_id_for_title);
        if let Some(win) = app_for_icon.get_webview_window(&label) {
            let _ = set_window_title_inner(&win, &url_for_icon).await;
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

/// 检测目标 URL 是否可达
#[tauri::command]
async fn check_url_reachable(url: String, timeout_secs: u64) -> Result<bool, String> {
    Ok(check_url_inner(&url, timeout_secs).await)
}

async fn check_url_inner(url: &str, timeout_secs: u64) -> bool {
    use std::time::Duration;

    let parsed = match url.parse::<url::Url>() {
        Ok(u) => u,
        Err(_) => return false,
    };
    let host = match parsed.host_str() {
        Some(h) => h,
        None => return false,
    };
    let port = parsed.port().unwrap_or(80);

    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    loop {
        let addr = format!("{}:{}", host, port);
        let socket_addr: std::net::SocketAddr = match addr.parse() {
            Ok(a) => a,
            Err(_) => {
                match std::net::ToSocketAddrs::to_socket_addrs(&((host, port))) {
                    Ok(mut addrs) => addrs.next().unwrap_or_else(|| {
                        std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port)
                    }),
                    Err(_) => std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port),
                }
            }
        };
        match std::net::TcpStream::connect_timeout(&socket_addr, Duration::from_millis(500)) {
            Ok(_) => return true,
            Err(_) => {}
        }

        if start.elapsed() >= timeout {
            return false;
        }

        tokio::time::sleep(Duration::from_millis(300)).await;
    }
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

// ── Favicon ──

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

async fn set_dock_icon_from_url_inner(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let parsed = url.parse::<url::Url>().map_err(|e| format!("无效的 URL: {}", e))?;
    let origin = parsed.origin().ascii_serialization();

    let (icon_bytes, fmt) = fetch_favicon(&origin).await?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app = app.clone();
    app.run_on_main_thread(move || {
        let result = set_macos_dock_icon(&icon_bytes, &fmt);
        let _ = tx.send(result);
    }).map_err(|e| format!("调度到主线程失败: {}", e))?;

    rx.recv().map_err(|e| format!("等待主线程执行失败: {}", e))?
}

/// 恢复默认 Dock 图标
#[tauri::command]
fn reset_dock_icon(app: tauri::AppHandle) -> Result<(), String> {
    reset_dock_icon_inner(&app)
}

fn reset_dock_icon_inner(app: &tauri::AppHandle) -> Result<(), String> {
    let icon_bytes = DEFAULT_ICON_BYTES.to_vec();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app = app.clone();
    app.run_on_main_thread(move || {
        let result = set_macos_dock_icon(&icon_bytes, "png");
        let _ = tx.send(result);
    }).map_err(|e| format!("调度到主线程失败: {}", e))?;

    rx.recv().map_err(|e| format!("等待主线程执行失败: {}", e))?
}

/// 从目标 URL 获取页面标题并设置为窗口标题
#[tauri::command]
async fn set_window_title_from_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    set_window_title_inner(&window, &url).await
}

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

fn detect_image_format(data: &[u8]) -> Option<String> {
    if data.len() < 4 { return None; }
    if data[0..4] == [0x89, 0x50, 0x4E, 0x47] { return Some("png".to_string()); }
    if data[0..3] == [0xFF, 0xD8, 0xFF] { return Some("jpeg".to_string()); }
    if data[0..4] == [0x00, 0x00, 0x01, 0x00] { return Some("ico".to_string()); }
    let head = String::from_utf8_lossy(&data[..data.len().min(100)]);
    if head.contains("<svg") { return Some("svg".to_string()); }
    if data[0..3] == [0x47, 0x49, 0x46] { return Some("gif".to_string()); }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" { return Some("webp".to_string()); }
    None
}

async fn fetch_favicon(origin: &str) -> Result<(Vec<u8>, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let candidates: Vec<(&str, &str)> = vec![
        ("/apple-touch-icon.png", "png"),
        ("/favicon.ico", "ico"),
        ("/favicon-32x32.png", "png"),
        ("/favicon-16x16.png", "png"),
    ];

    for (path, _expected_fmt) in &candidates {
        if let Some(bytes) = fetch_icon_url(&client, origin, path).await {
            if let Some(detected) = detect_image_format(&bytes) {
                return Ok((bytes, detected));
            }
        }
    }

    let html_url = format!("{}/", origin);
    if let Ok(resp) = client.get(&html_url).send().await {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                let icons = extract_icons_from_html(&html);
                for (href, _) in &icons {
                    if let Some(bytes) = fetch_icon_url(&client, origin, href).await {
                        if let Some(detected) = detect_image_format(&bytes) {
                            return Ok((bytes, detected));
                        }
                    }
                }
            }
        }
    }

    Err("未能获取到 favicon".to_string())
}

async fn fetch_icon_url(client: &reqwest::Client, origin: &str, path: &str) -> Option<Vec<u8>> {
    let full_url = if path.starts_with("http") {
        path.to_string()
    } else if path.starts_with("//") {
        format!("https:{}", path)
    } else if path.starts_with('/') {
        format!("{}{}", origin, path)
    } else {
        format!("{}/{}", origin, path)
    };
    let resp = client.get(&full_url).send().await.ok()?;
    if !resp.status().is_success() { return None; }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() { return None; }
    Some(bytes.to_vec())
}

fn extract_icons_from_html(html: &str) -> Vec<(String, String)> {
    let mut results = Vec::new();
    let lower = html.to_lowercase();
    let mut pos = 0usize;
    while let Some(link_start) = lower[pos..].find("<link ") {
        let abs_start = pos + link_start;
        let tag_end = lower[abs_start..].find('>').unwrap_or(lower.len() - abs_start - 1);
        let tag = &lower[abs_start..abs_start + tag_end];

        let rel = extract_attr(tag, "rel");
        let href = extract_attr(tag, "href");
        let type_attr = extract_attr(tag, "type");

        if let (Some(rel_val), Some(href_val)) = (rel, href) {
            let is_icon = rel_val.contains("icon") || rel_val.contains("shortcut");
            if is_icon {
                let fmt = if type_attr.as_deref() == Some("image/svg+xml") || href_val.ends_with(".svg") {
                    "svg".to_string()
                } else if href_val.ends_with(".png") || type_attr.as_deref() == Some("image/png") {
                    "png".to_string()
                } else {
                    "ico".to_string()
                };
                let priority = rel_val.contains("apple-touch");
                results.push((href_val, fmt, priority));
            }
        }
        pos = abs_start + tag_end + 1;
        if pos >= lower.len() { break; }
    }
    results.sort_by(|a, b| b.2.cmp(&a.2));
    results.into_iter().map(|(h, f, _)| (h, f)).collect()
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let patterns = [format!("{}=\"", attr), format!("{}='", attr)];
    for pattern in patterns {
        if let Some(start) = tag.find(&pattern) {
            let value_start = start + pattern.len();
            let quote = &pattern[pattern.len() - 1..];
            if let Some(end) = tag[value_start..].find(quote) {
                return Some(tag[value_start..value_start + end].to_string());
            }
        }
    }
    None
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title>")?;
    let end = lower.find("</title>")?;
    if end <= start + 7 { return None; }
    let title = html[start + 7..end].trim().to_string();
    if title.is_empty() { return None; }
    Some(title)
}

// ── macOS Dock 图标 ──

#[cfg(target_os = "macos")]
fn set_macos_dock_icon(data: &[u8], fmt: &str) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{NSData, MainThreadMarker, NSSize, NSString as NSNSString};

    let mtm = MainThreadMarker::new().ok_or("不在主线程")?;
    let app = NSApplication::sharedApplication(mtm);

    let dock_points: f64 = 256.0;

    if fmt == "svg" {
        let tmp_path = std::env::temp_dir().join("qqr-dock-icon.svg");
        std::fs::write(&tmp_path, data).map_err(|e| format!("写入临时文件失败: {}", e))?;
        let ns_path = NSNSString::from_str(tmp_path.to_str().unwrap_or(""));
        let ns_image = NSImage::initWithContentsOfFile(NSImage::alloc(), &ns_path)
            .ok_or("NSImage 无法加载 SVG 文件")?;
        ns_image.setSize(NSSize { width: dock_points, height: dock_points });
        unsafe { app.setApplicationIconImage(Some(&ns_image)) };
        return Ok(());
    }

    let resized = resize_for_dock(data)?;
    let ns_data = NSData::with_bytes(&resized);
    let ns_image = NSImage::initWithData(NSImage::alloc(), &ns_data)
        .ok_or("NSImage 无法创建图片")?;
    ns_image.setSize(NSSize { width: dock_points, height: dock_points });
    unsafe { app.setApplicationIconImage(Some(&ns_image)) };
    Ok(())
}

fn resize_for_dock(data: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(data)
        .map_err(|e| format!("解码图片失败: {}", e))?;

    let size: u32 = 512;
    let (w, h) = (img.width(), img.height());
    let scale = size as f32 / w.max(h) as f32;
    let new_w = (w as f32 * scale).round() as u32;
    let new_h = (h as f32 * scale).round() as u32;
    let resized = img.resize(new_w, new_h, image::imageops::FilterType::Lanczos3);

    let mut canvas = image::RgbaImage::new(size, size);
    let x = ((size - new_w) / 2) as i64;
    let y = ((size - new_h) / 2) as i64;
    image::imageops::overlay(&mut canvas, &resized, x, y);

    let mut buf = Vec::new();
    canvas.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;
    Ok(buf)
}
