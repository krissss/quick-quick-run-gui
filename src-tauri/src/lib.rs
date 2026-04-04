use std::process::{Command, Stdio, Child};
#[cfg(not(target_os = "windows"))]
use std::os::unix::process::CommandExt;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[cfg(not(debug_assertions))]
use tauri::WebviewUrl;

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
        // 1. 用进程组 kill（杀掉 sh 和它拉起的所有子进程）
        let pgid = state.pgid.lock().unwrap();
        if let Some(p) = *pgid {
            unsafe {
                // 先 SIGTERM 优雅退出
                libc::killpg(p as i32, libc::SIGTERM);
            }
            drop(pgid); // 提前释放锁

            std::thread::sleep(std::time::Duration::from_millis(300));

            // 再 SIGKILL 强制清除残留
            let pgid = state.pgid.lock().unwrap();
            if let Some(p) = *pgid {
                unsafe {
                    libc::killpg(p as i32, libc::SIGKILL);
                }
            }
        }

        // 2. 用 Child 句柄也 kill 一下
        let mut child_guard = state.child.lock().unwrap();
        if let Some(ref mut c) = *child_guard {
            let _ = c.kill();
        }

        let pid = child_guard.as_ref().map(|c| c.id()).unwrap_or(0);
        *child_guard = None;

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
