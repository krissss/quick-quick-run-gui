use std::collections::HashMap;
use std::io::BufRead;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use command_group::CommandGroup;
use tauri::{Emitter, Manager};

/// 每个正在运行的应用进程信息
pub struct ProcessInfo {
    pub child: Option<command_group::GroupChild>,
    pub logs: Arc<Mutex<Vec<String>>>,
}

/// 全局进程状态，支持多个应用同时运行
pub struct AppState {
    pub processes: Mutex<HashMap<String, ProcessInfo>>,
}

/// 杀掉指定 app_id 的进程（包括整个进程组）
pub fn kill_app_process(handle: &tauri::AppHandle, app_id: &str) {
    if let Some(state) = handle.try_state::<AppState>() {
        let info = {
            let mut processes = state.processes.lock().unwrap();
            processes.remove(app_id)
        };
        if let Some(info) = info {
            if let Some(mut child) = info.child {
                let _ = child.kill();
            }
        }
    }
    let _ = handle.emit("app-stopped", app_id.to_string());
}

/// 强制杀掉所有子进程
pub fn force_kill_all(handle: &tauri::AppHandle) {
    let infos: Vec<ProcessInfo> = {
        if let Some(state) = handle.try_state::<AppState>() {
            let mut processes = state.processes.lock().unwrap();
            processes.drain().map(|(_, v)| v).collect()
        } else {
            return;
        }
    };
    for info in infos {
        if let Some(mut child) = info.child {
            let _ = child.kill();
        }
    }
}

/// 获取当前用户的 shell 路径（Unix）
#[cfg(not(target_os = "windows"))]
fn get_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

/// 启动 shell 进程（在独立进程组中），返回 (GroupChild, pid)
pub fn spawn_shell_command(command: &str) -> Result<(command_group::GroupChild, u32), String> {
    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    let child = Command::new(get_shell())
        .arg("-c")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .group_spawn()
        .map_err(|e| format!("启动命令失败: {}", e))?;

    #[cfg(target_os = "windows")]
    let child = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("cmd")
            .args(["/C", command])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .group_spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?
    };

    let pid = child.id();
    Ok((child, pid))
}

/// 生成窗口标签：app-{app_id 前 8 字符}
pub fn window_label_for(app_id: &str) -> String {
    let short = &app_id[..app_id.len().min(8)];
    format!("app-{}", short)
}

/// 启动异步任务读取进程 stdout/stderr 并批量转发事件
/// 每 100ms 或积累 50 行时批量发送，避免频繁 IPC
pub fn spawn_log_reader(
    app: &tauri::AppHandle,
    app_id: &str,
    output: impl std::io::Read + Send + 'static,
    logs: Arc<Mutex<Vec<String>>>,
) {
    let app_handle = app.clone();
    let app_id = app_id.to_string();
    tokio::task::spawn_blocking(move || {
        let reader = std::io::BufReader::new(output);
        let mut pending_lines = Vec::with_capacity(50);
        let mut last_emit = std::time::Instant::now();
        const BATCH_DELAY: std::time::Duration = std::time::Duration::from_millis(100);
        const MAX_BATCH_SIZE: usize = 50;

        // 定义刷新函数
        let flush = |lines: &mut Vec<String>| {
            if lines.is_empty() {
                return;
            }
            let payload = serde_json::json!({
                "app_id": app_id,
                "lines": std::mem::take(lines),
            });
            let _ = app_handle.emit("app-log-batch", payload);
        };

        for line in reader.lines().flatten() {
            pending_lines.push(line.clone());

            // 添加到日志缓冲
            {
                let mut buf = logs.lock().unwrap();
                buf.push(line);
                if buf.len() > 2000 {
                    let remove_count = buf.len() - 2000;
                    buf.drain(0..remove_count);
                }
            }

            // 达到批量大小或延迟时间时发送
            let now = std::time::Instant::now();
            if pending_lines.len() >= MAX_BATCH_SIZE || now.duration_since(last_emit) >= BATCH_DELAY {
                flush(&mut pending_lines);
                last_emit = now;
            }
        }

        // 发送剩余的行
        flush(&mut pending_lines);
    });
}

/// 监控进程退出：定期 try_wait，进程自然退出时 emit app-stopped + app-launch-failed
pub fn spawn_process_monitor(app: &tauri::AppHandle, app_id: &str) {
    let app = app.clone();
    let app_id = app_id.to_string();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let exited = {
                let state = match app.try_state::<AppState>() {
                    Some(s) => s,
                    None => return,
                };
                let mut processes = state.processes.lock().unwrap();
                match processes.get_mut(&app_id) {
                    Some(info) => {
                        if let Some(ref mut child) = info.child {
                            match child.try_wait() {
                                Ok(Some(_)) => true,
                                Ok(None) => false,
                                Err(_) => true,
                            }
                        } else {
                            false
                        }
                    }
                    None => return, // 已被 kill_app_process 移除，停止监控
                }
            };
            if exited {
                let state = app.state::<AppState>();
                state.processes.lock().unwrap().remove(&app_id);
                let _ = app.emit("app-stopped", app_id.clone());
                let _ = app.emit("app-launch-failed", serde_json::json!({
                    "app_id": app_id,
                    "reason": "process_exited",
                }));
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_label_short_id() {
        assert_eq!(window_label_for("abc"), "app-abc");
    }

    #[test]
    fn window_label_exact_8() {
        assert_eq!(window_label_for("abcdefgh"), "app-abcdefgh");
    }

    #[test]
    fn window_label_long_id_truncated() {
        assert_eq!(window_label_for("abcdefghijklmnop"), "app-abcdefgh");
    }

    #[test]
    fn window_label_single_char() {
        assert_eq!(window_label_for("x"), "app-x");
    }

    #[test]
    fn window_label_empty() {
        assert_eq!(window_label_for(""), "app-");
    }

    #[test]
    fn spawn_shell_command_empty_string() {
        assert!(spawn_shell_command("").is_err());
    }

    #[test]
    fn spawn_shell_command_whitespace_only() {
        assert!(spawn_shell_command("   ").is_err());
    }

    #[test]
    fn spawn_shell_command_valid() {
        let result = spawn_shell_command("echo hello");
        assert!(result.is_ok());
        let (mut child, pid) = result.unwrap();
        assert!(pid > 0);
        let _ = child.kill();
    }
}
