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

/// 启动 shell 进程（在独立进程组中），返回 (GroupChild, pid)
pub fn spawn_shell_command(command: &str) -> Result<(command_group::GroupChild, u32), String> {
    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    let child = Command::new("sh")
        .arg("-c")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .group_spawn()
        .map_err(|e| format!("启动命令失败: {}", e))?;

    #[cfg(target_os = "windows")]
    let child = Command::new("cmd")
        .args(["/C", command])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .group_spawn()
        .map_err(|e| format!("启动命令失败: {}", e))?;

    let pid = child.id();
    Ok((child, pid))
}

/// 生成窗口标签：app-{app_id 前 8 字符}
pub fn window_label_for(app_id: &str) -> String {
    let short = &app_id[..app_id.len().min(8)];
    format!("app-{}", short)
}

/// 启动后台线程读取进程 stdout/stderr 并转发事件
pub fn spawn_log_reader(
    app: &tauri::AppHandle,
    app_id: &str,
    output: impl std::io::Read + Send + 'static,
    logs: Arc<Mutex<Vec<String>>>,
) {
    let app_handle = app.clone();
    let app_id = app_id.to_string();
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(output);
        for line in reader.lines().flatten() {
            let _ = app_handle.emit("app-log", serde_json::json!({
                "app_id": app_id,
                "line": line,
            }));
            let mut buf = logs.lock().unwrap();
            buf.push(line);
            if buf.len() > 2000 {
                let remove_count = buf.len() - 2000;
                buf.drain(0..remove_count);
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
