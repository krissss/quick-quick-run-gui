use std::process::{Command, Stdio, Child};
#[cfg(not(target_os = "windows"))]
use std::os::unix::process::CommandExt;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[cfg(not(debug_assertions))]
use tauri::WebviewUrl;

/// 默认 Dock 图标数据（编译时嵌入，用于恢复）
#[cfg(target_os = "macos")]
static DEFAULT_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");

/// 存储子进程信息（句柄 + 进程组 ID）
pub struct AppState {
    pub child: Mutex<Option<Child>>,
    /// 进程组 ID（用于 Unix 下杀掉整棵进程树）
    #[cfg(not(target_os = "windows"))]
    pub pgid: Mutex<Option<u32>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            child: Mutex::new(None),
            #[cfg(not(target_os = "windows"))]
            pgid: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            launch_command,
            kill_process,
            navigate_to_url,
            navigate_to_settings,
            check_url_reachable,
            resize_window,
            set_dock_icon_from_url,
            reset_dock_icon,
            set_window_title_from_url,
        ])
        .setup(|app| {
            // 应用退出时自动清理子进程
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

/// 强制杀掉所有子进程（进程组级别）
fn force_kill_all(handle: &tauri::AppHandle) {
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(state) = handle.try_state::<AppState>() {
            // 1. 先用进程组 kill
            {
                let pgid = state.pgid.lock().unwrap();
                if let Some(p) = *pgid {
                    unsafe {
                        libc::killpg(p as i32, libc::SIGTERM);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    unsafe {
                        libc::killpg(p as i32, libc::SIGKILL);
                    }
                }
            }
            // 2. 再用 Child 句柄 kill
            {
                let mut child = state.child.lock().unwrap();
                if let Some(ref mut c) = *child {
                    let _ = c.kill();
                }
                *child = None;
            }
            // 3. 清理 pgid
            {
                let mut pgid = state.pgid.lock().unwrap();
                *pgid = None;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(state) = handle.try_state::<AppState>() {
            let mut child = state.child.lock().unwrap();
            if let Some(ref mut c) = *child {
                let _ = c.kill();
            }
            *child = None;
        }
    }
}

/// 执行用户配置的命令（通过 shell 执行，支持 cd、&&、管道等完整 shell 语法）
#[tauri::command]
fn launch_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    command: String,
) -> Result<String, String> {
    // 先杀掉之前的进程（如果有）
    force_kill_all(&app);

    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }

    // 通过 shell 执行，支持完整的 shell 语法
    // 使用进程组，确保后续可以整棵进程树一起杀掉
    #[cfg(not(target_os = "windows"))]
    let child = unsafe {
        Command::new("sh")
            .arg("-c")
            .arg(&command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .pre_exec(|| {
                // 让 shell 成为新的进程组首领，这样它的所有子进程都在同一组
                libc::setsid();
                Ok(())
            })
            .spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?
    };

    #[cfg(target_os = "windows")]
    let child = Command::new("cmd")
        .args(["/C", &command])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x00000200) // CREATE_NEW_PROCESS_GROUP
        .spawn()
        .map_err(|e| format!("启动命令失败: {}", e))?;

    let pid = child.id();

    // 保存子进程句柄和进程组 ID
    {
        let mut state_child = state.child.lock().unwrap();
        *state_child = Some(child);
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 在 Unix 上，setsid 后 PID == PGID
        let mut state_pgid = state.pgid.lock().unwrap();
        *state_pgid = Some(pid);
    }

    // 发送事件通知前端
    let _ = app.emit("process-started", pid);

    Ok(format!("进程已启动, PID: {}", pid))
}

/// 杀掉当前运行的子进程（包括所有子进程）
#[tauri::command]
fn kill_process(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        // 1. SIGTERM 进程组
        {
            let pgid = state.pgid.lock().unwrap();
            if let Some(p) = *pgid {
                unsafe { libc::killpg(p as i32, libc::SIGTERM); }
            }
        } // pgid 锁在这里释放

        std::thread::sleep(std::time::Duration::from_millis(300));

        // 2. SIGKILL 残留
        {
            let pgid = state.pgid.lock().unwrap();
            if let Some(p) = *pgid {
                unsafe { libc::killpg(p as i32, libc::SIGKILL); }
            }
        }

        // 3. 用 Child 句柄也 kill 一下
        let pid = {
            let mut child_guard = state.child.lock().unwrap();
            if let Some(ref mut c) = *child_guard {
                let _ = c.kill();
            }
            let pid = child_guard.as_ref().map(|c| c.id()).unwrap_or(0);
            *child_guard = None;
            pid
        }; // child 锁释放

        {
            let mut pgid = state.pgid.lock().unwrap();
            *pgid = None;
        }

        if pid > 0 {
            return Ok(format!("进程组 {} 已终止", pid));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut child_guard = state.child.lock().unwrap();
        if let Some(ref mut c) = *child_guard {
            match c.kill() {
                Ok(_) => {
                    let pid = c.id();
                    *child_guard = None;
                    return Ok(format!("进程 {} 已终止", pid));
                }
                Err(e) => return Err(format!("终止进程失败: {}", e)),
            }
        }
    }

    Err("没有正在运行的进程".to_string())
}

/// 导航 WebView 到指定 URL
#[tauri::command]
fn navigate_to_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    let parsed = url.parse::<url::Url>().map_err(|e| format!("无效的 URL: {}", e))?;
    window.navigate(parsed).map_err(|e| format!("导航失败: {}", e))
}

/// 导航回设置页面（dev 模式用 Vite 地址，生产用 index.html）
#[tauri::command]
fn navigate_to_settings(window: tauri::WebviewWindow, dev_url: Option<String>) -> Result<(), String> {
    // 恢复默认窗口标题
    window.set_title("Quick Quick Run GUI").map_err(|e| format!("设置标题失败: {}", e))?;

    #[cfg(debug_assertions)]
    {
        let url_str = dev_url.unwrap_or_else(|| "http://localhost:5173".to_string());
        let parsed = url_str.parse::<url::Url>().map_err(|e| format!("无效的 URL: {}", e))?;
        window.navigate(parsed).map_err(|e| format!("导航失败: {}", e))?;
    }
    #[cfg(not(debug_assertions))]
    {
        window.navigate(WebviewUrl::App("index.html".into())).map_err(|e| format!("导航失败: {}", e))?;
    }
    Ok(())
}

/// 从目标 URL 获取页面标题并设置为窗口标题
#[tauri::command]
async fn set_window_title_from_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client.get(&url).send().await.map_err(|e| format!("请求失败: {}", e))?;
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

/// 从 HTML 中提取 <title> 内容
fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title>")?;
    let end = lower.find("</title>")?;
    if end <= start + 7 { return None; }
    let title = html[start + 7..end].trim().to_string();
    if title.is_empty() { return None; }
    Some(title)
}

/// 检测目标 URL 是否可达（用于等待服务就绪）
#[tauri::command]
async fn check_url_reachable(url: String, timeout_secs: u64) -> Result<bool, String> {
    use std::time::Duration;

    let parsed = url.parse::<url::Url>().map_err(|e| format!("无效的 URL: {}", e))?;
    let host = parsed.host_str().ok_or_else(|| "无法解析主机地址".to_string())?;
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
        match std::net::TcpStream::connect_timeout(
            &socket_addr,
            Duration::from_millis(500),
        ) {
            Ok(_) => return Ok(true),
            Err(_) => {}
        }

        if start.elapsed() >= timeout {
            return Ok(false);
        }

        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

/// 调整窗口大小
#[tauri::command]
fn resize_window(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize { width, height })
        .map_err(|e| format!("调整窗口失败: {}", e))
}

/// 从目标 URL 获取 favicon 并设置为 macOS Dock 图标
#[tauri::command]
async fn set_dock_icon_from_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url.parse::<url::Url>().map_err(|e| format!("无效的 URL: {}", e))?;
    let origin = parsed.origin().ascii_serialization();

    let (icon_bytes, fmt) = fetch_favicon(&origin).await?;

    // NSApplication 必须在主线程调用，通过 run_on_main_thread 调度
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = set_macos_dock_icon(&icon_bytes, &fmt);
        let _ = tx.send(result);
    }).map_err(|e| format!("调度到主线程失败: {}", e))?;

    rx.recv().map_err(|e| format!("等待主线程执行失败: {}", e))?
}

/// 恢复默认 Dock 图标
#[tauri::command]
fn reset_dock_icon(app: tauri::AppHandle) -> Result<(), String> {
    let icon_bytes = DEFAULT_ICON_BYTES.to_vec();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = set_macos_dock_icon(&icon_bytes, "png");
        let _ = tx.send(result);
    }).map_err(|e| format!("调度到主线程失败: {}", e))?;

    rx.recv().map_err(|e| format!("等待主线程执行失败: {}", e))?
}

/// 检测字节数据是否为有效图片格式
fn detect_image_format(data: &[u8]) -> Option<String> {
    if data.len() < 4 { return None; }
    // PNG: 89 50 4E 47
    if data[0..4] == [0x89, 0x50, 0x4E, 0x47] { return Some("png".to_string()); }
    // JPEG: FF D8 FF
    if data[0..3] == [0xFF, 0xD8, 0xFF] { return Some("jpeg".to_string()); }
    // ICO: 00 00 01 00
    if data[0..4] == [0x00, 0x00, 0x01, 0x00] { return Some("ico".to_string()); }
    // SVG (文本)
    let head = String::from_utf8_lossy(&data[..data.len().min(100)]);
    if head.contains("<svg") { return Some("svg".to_string()); }
    // GIF: 47 49 46
    if data[0..3] == [0x47, 0x49, 0x46] { return Some("gif".to_string()); }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" { return Some("webp".to_string()); }
    None
}

/// 尝试获取 favicon 字节数据和格式
async fn fetch_favicon(origin: &str) -> Result<(Vec<u8>, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 尝试获取的候选 URL 列表
    let candidates: Vec<(&str, &str)> = vec![
        ("/apple-touch-icon.png", "png"),
        ("/favicon.ico", "ico"),
        ("/favicon-32x32.png", "png"),
        ("/favicon-16x16.png", "png"),
    ];

    for (path, _expected_fmt) in &candidates {
        let _full_url = format!("{}{}", origin, path);
        if let Some(bytes) = fetch_icon_url(&client, origin, path).await {
            // 用 magic bytes 验证是否为真正的图片
            if let Some(detected) = detect_image_format(&bytes) {
                return Ok((bytes, detected));
            }
        }
    }

    // 解析 HTML 中的 <link> 图标
    let html_url = format!("{}/", origin);
    if let Ok(resp) = client.get(&html_url).send().await {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                let icons = extract_icons_from_html(&html);
                // 按 png > ico > svg 优先级尝试
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

/// 从 HTML 中提取所有 icon 链接及其格式 (href, format)
fn extract_icons_from_html(html: &str) -> Vec<(String, String)> {
    let mut results = Vec::new();
    // 把整个 HTML 当作一个字符串搜索，避免按行分割丢失跨行标签
    let lower = html.to_lowercase();
    let search_from = 0usize;
    let mut pos = search_from;
    while let Some(link_start) = lower[pos..].find("<link ") {
        let abs_start = pos + link_start;
        // 找到标签结束
        let tag_end = lower[abs_start..].find('>').unwrap_or(lower.len() - abs_start - 1);
        let tag = &lower[abs_start..abs_start + tag_end];

        let rel = extract_attr(tag, "rel");
        let href = extract_attr(tag, "href");
        let type_attr = extract_attr(tag, "type");

        if let (Some(rel_val), Some(href_val)) = (rel, href) {
            let is_icon = rel_val.contains("icon") || rel_val.contains("shortcut");
            if is_icon {
                // 推断格式
                let fmt = if type_attr.as_deref() == Some("image/svg+xml") || href_val.ends_with(".svg") {
                    "svg".to_string()
                } else if href_val.ends_with(".png") || type_attr.as_deref() == Some("image/png") {
                    "png".to_string()
                } else {
                    "ico".to_string()
                };
                // apple-touch-icon 优先
                let priority = rel_val.contains("apple-touch");
                results.push((href_val, fmt, priority));
            }
        }
        pos = abs_start + tag_end + 1;
        if pos >= lower.len() { break; }
    }
    // apple-touch-icon 排前面
    results.sort_by(|a, b| b.2.cmp(&a.2));
    results.into_iter().map(|(h, f, _)| (h, f)).collect()
}

/// 从 HTML 标签属性中提取值
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

/// macOS: 设置 Dock 图标（支持 PNG/ICO/SVG）
#[cfg(target_os = "macos")]
fn set_macos_dock_icon(data: &[u8], fmt: &str) -> Result<(), String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{NSData, MainThreadMarker, NSSize, NSString as NSNSString};

    let mtm = MainThreadMarker::new().ok_or("不在主线程")?;
    let app = NSApplication::sharedApplication(mtm);

    // Dock 图标的标准逻辑尺寸（points），512x512 像素对应 256x256 points (2x Retina)
    let dock_points: f64 = 256.0;

    if fmt == "svg" {
        let tmp_path = std::env::temp_dir().join("qqr-dock-icon.svg");
        std::fs::write(&tmp_path, data).map_err(|e| format!("写入临时文件失败: {}", e))?;
        let ns_path = NSNSString::from_str(tmp_path.to_str().unwrap_or(""));
        let ns_image = NSImage::initWithContentsOfFile(NSImage::alloc(), &ns_path)
            .ok_or("NSImage 无法加载 SVG 文件")?;
        // 设置逻辑尺寸，确保 Retina 下不会渲染过大
        ns_image.setSize(NSSize { width: dock_points, height: dock_points });
        unsafe { app.setApplicationIconImage(Some(&ns_image)) };
        return Ok(());
    }

    let resized = resize_for_dock(data)?;
    let ns_data = NSData::with_bytes(&resized);
    let ns_image = NSImage::initWithData(NSImage::alloc(), &ns_data)
        .ok_or("NSImage 无法创建图片")?;
    // initWithData 会将像素尺寸当作 point 尺寸（512px → 512pt），
    // 在 Retina (2x) 下会导致图标渲染为 2 倍大小。
    // 修正：设置为 256pt，告诉系统这是 2x 分辨率数据。
    ns_image.setSize(NSSize { width: dock_points, height: dock_points });
    unsafe { app.setApplicationIconImage(Some(&ns_image)) };
    Ok(())
}

/// 将 favicon 处理为 Dock 图标（与默认图标相同的 512x512 尺寸）
fn resize_for_dock(data: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(data)
        .map_err(|e| format!("解码图片失败: {}", e))?;

    // 与默认 icon.png 相同尺寸 512x512，避免 setApplicationIconImage 渲染偏大
    let size: u32 = 512;

    // 缩放铺满画布（macOS 会自动加圆角遮罩）
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
