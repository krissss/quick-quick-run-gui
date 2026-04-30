use std::collections::HashMap;
use std::collections::HashSet;
use std::io::Write;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use command_group::CommandGroup;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "qqr-store.json";
const SESSIONS_KEY: &str = "running_sessions";
const LOG_TAIL_BYTES: u64 = 1024 * 1024;

/// Lock a Mutex, recovering from poison by taking the guard.
fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct AppWindowInfo {
    pub url: String,
    pub width: f64,
    pub height: f64,
    pub app_name: String,
    pub bg_r: u8,
    pub bg_g: u8,
    pub bg_b: u8,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PersistedSession {
    pub app_id: String,
    pub command: String,
    pub url: String,
    pub pid: u32,
    pub log_path: String,
    pub started_at: u64,
    pub window: AppWindowInfo,
}

/// 每个正在运行的应用进程信息
pub struct ProcessInfo {
    pub child: Option<command_group::GroupChild>,
    pub pid: Option<u32>,
    pub log_path: Option<PathBuf>,
    pub logs: Arc<Mutex<Vec<String>>>,
    pub window: AppWindowInfo,
}

/// 全局进程状态，支持多个应用同时运行
pub struct AppState {
    pub processes: Mutex<HashMap<String, ProcessInfo>>,
}

/// 杀掉指定 app_id 的进程（包括整个进程组）
pub fn kill_app_process(handle: &tauri::AppHandle, app_id: &str) {
    if let Some(state) = handle.try_state::<AppState>() {
        let info = {
            let mut processes = recover_lock(&state.processes);
            processes.remove(app_id)
        };
        if let Some(info) = info {
            kill_process_info(info);
        }
    }
    remove_persisted_session(handle, app_id);
    let _ = handle.emit("app-stopped", app_id.to_string());
}

/// 强制杀掉所有子进程
pub fn force_kill_all(handle: &tauri::AppHandle) {
    let (app_ids, infos): (HashSet<String>, Vec<ProcessInfo>) = {
        if let Some(state) = handle.try_state::<AppState>() {
            let mut processes = recover_lock(&state.processes);
            processes.drain().fold(
                (HashSet::new(), Vec::new()),
                |(mut ids, mut infos), (app_id, info)| {
                    ids.insert(app_id);
                    infos.push(info);
                    (ids, infos)
                },
            )
        } else {
            return;
        }
    };
    let mut app_ids = app_ids;
    for session in read_persisted_sessions(handle) {
        app_ids.insert(session.app_id);
    }
    for info in infos {
        kill_process_info(info);
    }
    save_persisted_sessions(handle, &[]);
    for app_id in app_ids {
        let _ = handle.emit("app-stopped", app_id);
    }
}

/// 获取当前用户的 shell 路径（Unix）
#[cfg(not(target_os = "windows"))]
fn get_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

/// 启动 shell 进程（在独立进程组中），返回 (GroupChild, pid)
pub fn spawn_shell_command(
    command: &str,
    log_path: Option<&Path>,
) -> Result<(command_group::GroupChild, u32), String> {
    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }

    let mut stdout = Stdio::piped();
    let mut stderr = Stdio::piped();

    if let Some(path) = log_path {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建日志目录失败: {}", e))?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| format!("打开日志文件失败: {}", e))?;
        let _ = writeln!(file, "\n[qqr] started at {}: {}", now_millis(), command);
        stdout = Stdio::from(
            file.try_clone()
                .map_err(|e| format!("复制日志文件句柄失败: {}", e))?,
        );
        stderr = Stdio::from(file);
    }

    #[cfg(not(target_os = "windows"))]
    let child = Command::new(get_shell())
        .arg("-c")
        .arg(command)
        .stdout(stdout)
        .stderr(stderr)
        .group_spawn()
        .map_err(|e| format!("启动命令失败: {}", e))?;

    #[cfg(target_os = "windows")]
    let child = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("cmd")
            .args(["/C", command])
            .stdout(stdout)
            .stderr(stderr)
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

/// 监控进程退出：定期 try_wait，进程自然退出时只清理 PID，保留窗口运行态
pub fn spawn_process_monitor(app: &tauri::AppHandle, app_id: &str) {
    let app = app.clone();
    let app_id = app_id.to_string();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let exited = {
                let state = match app.try_state::<AppState>() {
                    Some(s) => s,
                    None => return,
                };
                let mut processes = recover_lock(&state.processes);
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
                let mut processes = recover_lock(&state.processes);
                if let Some(info) = processes.get_mut(&app_id) {
                    info.child = None;
                    info.pid = None;
                }
                remove_persisted_session(&app, &app_id);
                let _ = app.emit("app-process-stopped", app_id.clone());
                return;
            }
        }
    });
}

pub fn spawn_recovered_process_monitor(app: &tauri::AppHandle, app_id: &str, pid: u32) {
    let app = app.clone();
    let app_id = app_id.to_string();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if is_process_alive(pid) {
                continue;
            }

            remove_persisted_session(&app, &app_id);
            if let Some(state) = app.try_state::<AppState>() {
                recover_lock(&state.processes).remove(&app_id);
            }
            let _ = app.emit("app-stopped", app_id.clone());
            return;
        }
    });
}

pub fn restore_persisted_sessions(handle: &tauri::AppHandle) {
    let sessions = read_persisted_sessions(handle);
    let mut live_sessions = Vec::new();

    for session in sessions {
        if !is_process_alive(session.pid) {
            continue;
        }

        let logs = Arc::new(Mutex::new(Vec::new()));
        let info = ProcessInfo {
            child: None,
            pid: Some(session.pid),
            log_path: Some(PathBuf::from(&session.log_path)),
            logs,
            window: session.window.clone(),
        };

        if let Some(state) = handle.try_state::<AppState>() {
            recover_lock(&state.processes).insert(session.app_id.clone(), info);
        }
        spawn_recovered_process_monitor(handle, &session.app_id, session.pid);
        live_sessions.push(session);
    }

    save_persisted_sessions(handle, &live_sessions);
}

pub fn read_log_tail(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(len) = file.metadata().map(|meta| meta.len()) else {
        return Vec::new();
    };
    let start = len.saturating_sub(LOG_TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }

    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }

    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<String> = text.lines().map(ToString::to_string).collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    if lines.len() > max_lines {
        lines.drain(0..lines.len() - max_lines);
    }
    lines
}

pub fn create_log_path(app: &tauri::AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("获取日志目录失败: {}", e))?;
    let dir = base.join("apps").join(sanitize_path_segment(app_id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建日志目录失败: {}", e))?;
    Ok(dir.join(format!("{}.log", now_millis())))
}

pub fn persist_session(handle: &tauri::AppHandle, session: PersistedSession) {
    let mut sessions = read_persisted_sessions(handle);
    sessions.retain(|item| item.app_id != session.app_id);
    sessions.push(session);
    save_persisted_sessions(handle, &sessions);
}

pub fn remove_persisted_session(handle: &tauri::AppHandle, app_id: &str) {
    let mut sessions = read_persisted_sessions(handle);
    let old_len = sessions.len();
    sessions.retain(|item| item.app_id != app_id);
    if sessions.len() != old_len {
        save_persisted_sessions(handle, &sessions);
    }
}

fn read_persisted_sessions(handle: &tauri::AppHandle) -> Vec<PersistedSession> {
    let Ok(store) = handle.store(STORE_FILE) else {
        return Vec::new();
    };
    store
        .get(SESSIONS_KEY)
        .and_then(|value| serde_json::from_value::<Vec<PersistedSession>>(value).ok())
        .unwrap_or_default()
}

fn save_persisted_sessions(handle: &tauri::AppHandle, sessions: &[PersistedSession]) {
    if let Ok(store) = handle.store(STORE_FILE) {
        let _ = store.set(
            SESSIONS_KEY,
            serde_json::to_value(sessions).unwrap_or_default(),
        );
        let _ = store.save();
    }
}

fn kill_process_info(info: ProcessInfo) {
    if let Some(mut child) = info.child {
        let _ = child.kill();
        return;
    }
    if let Some(pid) = info.pid {
        let _ = kill_process_group(pid);
    }
}

fn kill_process_group(pid: u32) -> std::io::Result<ExitStatus> {
    #[cfg(unix)]
    {
        let group = format!("-{}", pid);
        let status = Command::new("kill").args(["-KILL", &group]).status();
        if matches!(status.as_ref(), Ok(s) if s.success()) {
            return status;
        }
        Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status()
    }

    #[cfg(windows)]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
    }
}

fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(windows)]
    {
        let Ok(output) = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid)])
            .output()
        else {
            return false;
        };
        String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn sanitize_path_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "app".to_string()
    } else {
        sanitized
    }
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
        assert!(spawn_shell_command("", None).is_err());
    }

    #[test]
    fn spawn_shell_command_whitespace_only() {
        assert!(spawn_shell_command("   ", None).is_err());
    }

    #[test]
    fn spawn_shell_command_valid() {
        let result = spawn_shell_command("echo hello", None);
        assert!(result.is_ok());
        let (mut child, pid) = result.unwrap();
        assert!(pid > 0);
        let _ = child.kill();
    }
}
