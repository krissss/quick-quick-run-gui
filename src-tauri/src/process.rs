use std::collections::HashMap;
use std::collections::HashSet;
use std::io::Write;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Local, TimeZone};
use command_group::CommandGroup;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "qqr-store.json";
const SESSIONS_KEY: &str = "running_sessions";
const RUN_RECORDS_KEY: &str = "run_records";
const LOG_RETENTION_LIMIT_KEY: &str = "log_retention_limit";
const DEFAULT_LOG_RETENTION_LIMIT: usize = 20;
const MAX_LOG_RETENTION_LIMIT: usize = 200;
const LOG_TAIL_BYTES: u64 = 1024 * 1024;
const MAX_RUN_RECORDS: usize = 500;

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    #[default]
    Web,
    Service,
    Task,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    Running,
    Success,
    Failed,
    Killed,
    Lost,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunTrigger {
    Manual,
    Delayed,
    Schedule,
    StartupRecover,
    Startup,
    AutoRestart,
    Retry,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct RunRecord {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub item_type: ItemType,
    pub status: RunStatus,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub log_path: String,
    pub trigger: RunTrigger,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PersistedSession {
    pub app_id: String,
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub item_type: ItemType,
    pub command: String,
    #[serde(default)]
    pub working_directory: String,
    #[serde(default)]
    pub url: String,
    pub pid: u32,
    pub log_path: String,
    pub started_at: u64,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub window: Option<AppWindowInfo>,
}

/// 每个正在运行的应用进程信息
pub struct ProcessInfo {
    pub child: Option<command_group::GroupChild>,
    pub pid: Option<u32>,
    pub log_path: Option<PathBuf>,
    pub logs: Arc<Mutex<Vec<String>>>,
    pub item_type: ItemType,
    pub run_id: Option<String>,
    pub window: Option<AppWindowInfo>,
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
            finish_process_run(handle, &info, RunStatus::Killed, None);
            kill_process_info(info);
        }
    }
    remove_persisted_session(handle, app_id);
    let _ = handle.emit("app-stopped", app_id.to_string());
}

/// 强制杀掉所有子进程
#[cfg(target_os = "macos")]
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
    let killed_ids = app_ids.clone();
    for info in infos {
        finish_process_run(handle, &info, RunStatus::Killed, None);
        kill_process_info(info);
    }
    for session in read_persisted_sessions(handle) {
        if !killed_ids.contains(&session.app_id) {
            let _ = kill_process_group(session.pid);
            if let Some(run_id) = session.run_id {
                finish_run_record(handle, &run_id, RunStatus::Killed, None);
            }
        }
        app_ids.insert(session.app_id);
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
    working_directory: Option<&str>,
    log_path: Option<&Path>,
) -> Result<(command_group::GroupChild, u32), String> {
    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }
    let working_directory = resolve_working_directory(working_directory)?;

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
        let _ = writeln!(
            file,
            "\n[qqr] started at {}: {}",
            format_log_timestamp(now_millis()),
            command
        );
        if let Some(dir) = &working_directory {
            let _ = writeln!(file, "[qqr] cwd: {}", dir.display());
        }
        stdout = Stdio::from(
            file.try_clone()
                .map_err(|e| format!("复制日志文件句柄失败: {}", e))?,
        );
        stderr = Stdio::from(file);
    }

    #[cfg(not(target_os = "windows"))]
    let child = {
        let mut cmd = Command::new(get_shell());
        cmd.arg("-c").arg(command).stdout(stdout).stderr(stderr);
        if let Some(dir) = &working_directory {
            cmd.current_dir(dir);
        }
        cmd.group_spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?
    };

    #[cfg(target_os = "windows")]
    let child = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", command])
            .stdout(stdout)
            .stderr(stderr)
            .creation_flags(CREATE_NO_WINDOW);
        if let Some(dir) = &working_directory {
            cmd.current_dir(dir);
        }
        cmd.group_spawn()
            .map_err(|e| format!("启动命令失败: {}", e))?
    };

    let pid = child.id();
    Ok((child, pid))
}

fn resolve_working_directory(working_directory: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(raw) = working_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let path = if raw == "~" || raw.starts_with("~/") || raw.starts_with("~\\") {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .ok_or_else(|| "无法展开工作目录中的 ~".to_string())?;
        let suffix = raw.trim_start_matches('~').trim_start_matches(['/', '\\']);
        if suffix.is_empty() {
            PathBuf::from(home)
        } else {
            PathBuf::from(home).join(suffix)
        }
    } else {
        PathBuf::from(raw)
    };

    if !path.is_dir() {
        return Err(format!("工作目录不存在: {}", path.to_string_lossy()));
    }
    Ok(Some(path))
}

/// 生成窗口标签：app-{app_id 前 8 字符}
pub fn window_label_for(app_id: &str) -> String {
    let short = &app_id[..app_id.len().min(8)];
    format!("app-{}", short)
}

/// 监控进程退出：web 保留窗口运行态，service/task 退出后清掉运行态
pub fn spawn_process_monitor(app: &tauri::AppHandle, app_id: &str) {
    let app = app.clone();
    let app_id = app_id.to_string();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let exit_status = {
                let state = match app.try_state::<AppState>() {
                    Some(s) => s,
                    None => return,
                };
                let mut processes = recover_lock(&state.processes);
                match processes.get_mut(&app_id) {
                    Some(info) => {
                        if let Some(ref mut child) = info.child {
                            match child.try_wait() {
                                Ok(Some(status)) => Some(Some(status)),
                                Ok(None) => None,
                                Err(_) => {
                                    if should_keep_monitoring_after_wait_error(info.pid) {
                                        None
                                    } else {
                                        Some(None)
                                    }
                                }
                            }
                        } else {
                            None
                        }
                    }
                    None => return, // 已被 kill_app_process 移除，停止监控
                }
            };
            if let Some(status) = exit_status {
                let state = app.state::<AppState>();
                let mut processes = recover_lock(&state.processes);
                let info = match processes.get_mut(&app_id) {
                    Some(info) => {
                        info.child = None;
                        info.pid = None;
                        ProcessSnapshot {
                            item_type: info.item_type,
                            run_id: info.run_id.clone(),
                        }
                    }
                    None => return,
                };
                if info.item_type != ItemType::Web {
                    processes.remove(&app_id);
                }
                drop(processes);

                remove_persisted_session(&app, &app_id);
                if let Some(run_id) = info.run_id {
                    let (status, exit_code) = status
                        .as_ref()
                        .map(|status| (run_status_from_exit(status), status.code()))
                        .unwrap_or((RunStatus::Lost, None));
                    finish_run_record(&app, &run_id, status, exit_code);
                }
                if info.item_type == ItemType::Web {
                    let _ = app.emit("app-process-stopped", app_id.clone());
                } else {
                    let _ = app.emit("app-stopped", app_id.clone());
                }
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

            let run_id = if let Some(state) = app.try_state::<AppState>() {
                recover_lock(&state.processes)
                    .remove(&app_id)
                    .and_then(|info| info.run_id)
            } else {
                None
            };
            remove_persisted_session(&app, &app_id);
            if let Some(run_id) = run_id {
                finish_run_record(&app, &run_id, RunStatus::Lost, None);
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
            if let Some(run_id) = &session.run_id {
                finish_run_record(handle, run_id, RunStatus::Lost, None);
            }
            continue;
        }

        let mut should_monitor = false;
        if let Some(state) = handle.try_state::<AppState>() {
            let mut processes = recover_lock(&state.processes);
            if !processes.contains_key(&session.app_id) {
                processes.insert(
                    session.app_id.clone(),
                    ProcessInfo {
                        child: None,
                        pid: Some(session.pid),
                        log_path: Some(PathBuf::from(&session.log_path)),
                        logs: Arc::new(Mutex::new(Vec::new())),
                        item_type: session.item_type,
                        run_id: session.run_id.clone(),
                        window: session.window.clone(),
                    },
                );
                should_monitor = true;
            }
        }
        if should_monitor {
            spawn_recovered_process_monitor(handle, &session.app_id, session.pid);
        }
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

pub fn create_run_id(app_id: &str) -> String {
    format!("{}-{}", sanitize_path_segment(app_id), now_millis())
}

pub fn format_log_timestamp(timestamp_millis: u64) -> String {
    let Ok(timestamp) = i64::try_from(timestamp_millis) else {
        return timestamp_millis.to_string();
    };
    Local
        .timestamp_millis_opt(timestamp)
        .single()
        .map(|time| time.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| timestamp_millis.to_string())
}

pub fn append_run_record(handle: &tauri::AppHandle, record: RunRecord) {
    let mut records = read_run_records(handle);
    records.push(record.clone());
    let removed = prune_run_records(&mut records, read_log_retention_limit(handle));
    records.sort_by_key(|record| record.started_at);
    save_run_records(handle, &records);
    remove_log_files(&removed);
    emit_run_updated(handle, &record.app_id, &record.id, record.status);
}

pub fn finish_run_record(
    handle: &tauri::AppHandle,
    run_id: &str,
    status: RunStatus,
    exit_code: Option<i32>,
) {
    let mut records = read_run_records(handle);
    let mut updated = None;
    for record in &mut records {
        if record.id == run_id {
            record.status = status;
            record.exit_code = exit_code;
            record.finished_at = Some(now_millis());
            updated = Some((record.app_id.clone(), record.id.clone()));
            break;
        }
    }
    if let Some((app_id, run_id)) = updated {
        save_run_records(handle, &records);
        emit_run_updated(handle, &app_id, &run_id, status);
    }
}

pub fn get_run_records(
    handle: &tauri::AppHandle,
    app_id: Option<&str>,
    limit: usize,
) -> Vec<RunRecord> {
    let mut records: Vec<RunRecord> = read_run_records(handle)
        .into_iter()
        .filter(|record| app_id.map(|id| record.app_id == id).unwrap_or(true))
        .collect();
    records.sort_by_key(|record| std::cmp::Reverse(record.started_at));
    if records.len() > limit {
        records.truncate(limit);
    }
    records
}

pub fn clear_run_records(
    handle: &tauri::AppHandle,
    app_id: &str,
    run_ids: Option<Vec<String>>,
) -> usize {
    let selected: Option<HashSet<String>> = run_ids.map(|ids| ids.into_iter().collect());
    let mut records = read_run_records(handle);
    let mut removed = Vec::new();
    records.retain(|record| {
        let should_remove = record.app_id == app_id
            && record.status != RunStatus::Running
            && selected
                .as_ref()
                .map(|ids| ids.contains(&record.id))
                .unwrap_or(true);
        if should_remove {
            removed.push(record.clone());
        }
        !should_remove
    });
    if !removed.is_empty() {
        save_run_records(handle, &records);
        remove_log_files(&removed);
    }
    removed.len()
}

pub fn prune_run_records_for_retention(handle: &tauri::AppHandle) -> usize {
    let mut records = read_run_records(handle);
    let removed = prune_run_records(&mut records, read_log_retention_limit(handle));
    if !removed.is_empty() {
        save_run_records(handle, &records);
        remove_log_files(&removed);
    }
    removed.len()
}

pub fn read_log_retention_limit(handle: &tauri::AppHandle) -> usize {
    let Ok(store) = handle.store(STORE_FILE) else {
        return DEFAULT_LOG_RETENTION_LIMIT;
    };
    let _ = store.reload();
    store
        .get(LOG_RETENTION_LIMIT_KEY)
        .and_then(|value| serde_json::from_value::<usize>(value).ok())
        .map(normalize_log_retention_limit)
        .unwrap_or(DEFAULT_LOG_RETENTION_LIMIT)
}

pub fn latest_log_path_for_app(handle: &tauri::AppHandle, app_id: &str) -> Option<PathBuf> {
    get_run_records(handle, Some(app_id), 1)
        .first()
        .map(|record| PathBuf::from(&record.log_path))
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
    let _ = store.reload();
    store
        .get(SESSIONS_KEY)
        .and_then(|value| serde_json::from_value::<Vec<PersistedSession>>(value).ok())
        .unwrap_or_default()
}

fn save_persisted_sessions(handle: &tauri::AppHandle, sessions: &[PersistedSession]) {
    if let Ok(store) = handle.store(STORE_FILE) {
        let _ = store.reload();
        store.set(
            SESSIONS_KEY,
            serde_json::to_value(sessions).unwrap_or_default(),
        );
        let _ = store.save();
    }
}

fn read_run_records(handle: &tauri::AppHandle) -> Vec<RunRecord> {
    let Ok(store) = handle.store(STORE_FILE) else {
        return Vec::new();
    };
    let _ = store.reload();
    store
        .get(RUN_RECORDS_KEY)
        .and_then(|value| serde_json::from_value::<Vec<RunRecord>>(value).ok())
        .unwrap_or_default()
}

fn save_run_records(handle: &tauri::AppHandle, records: &[RunRecord]) {
    if let Ok(store) = handle.store(STORE_FILE) {
        let _ = store.reload();
        store.set(
            RUN_RECORDS_KEY,
            serde_json::to_value(records).unwrap_or_default(),
        );
        let _ = store.save();
    }
}

fn normalize_log_retention_limit(limit: usize) -> usize {
    limit.clamp(1, MAX_LOG_RETENTION_LIMIT)
}

fn prune_run_records(records: &mut Vec<RunRecord>, log_retention_limit: usize) -> Vec<RunRecord> {
    let limit = normalize_log_retention_limit(log_retention_limit);
    records.sort_by_key(|record| record.started_at);

    let mut remove_indices: HashSet<usize> = HashSet::new();
    let mut per_app_counts: HashMap<String, usize> = HashMap::new();
    for (index, record) in records.iter().enumerate().rev() {
        let count = per_app_counts.entry(record.app_id.clone()).or_default();
        if *count >= limit && record.status != RunStatus::Running {
            remove_indices.insert(index);
        } else {
            *count += 1;
        }
    }

    let retained_count = records.len().saturating_sub(remove_indices.len());
    if retained_count > MAX_RUN_RECORDS {
        let mut extra = retained_count - MAX_RUN_RECORDS;
        for (index, record) in records.iter().enumerate() {
            if extra == 0 {
                break;
            }
            if remove_indices.contains(&index) || record.status == RunStatus::Running {
                continue;
            }
            remove_indices.insert(index);
            extra -= 1;
        }
    }

    let mut removed = Vec::new();
    let mut retained = Vec::with_capacity(records.len().saturating_sub(remove_indices.len()));
    for (index, record) in records.drain(..).enumerate() {
        if remove_indices.contains(&index) {
            removed.push(record);
        } else {
            retained.push(record);
        }
    }
    *records = retained;
    removed
}

fn remove_log_files(records: &[RunRecord]) {
    for record in records {
        if record.log_path.is_empty() {
            continue;
        }
        let _ = std::fs::remove_file(&record.log_path);
    }
}

fn emit_run_updated(handle: &tauri::AppHandle, app_id: &str, run_id: &str, status: RunStatus) {
    let _ = handle.emit(
        "app-run-updated",
        serde_json::json!({
            "app_id": app_id,
            "run_id": run_id,
            "status": status,
        }),
    );
}

struct ProcessSnapshot {
    item_type: ItemType,
    run_id: Option<String>,
}

fn finish_process_run(
    handle: &tauri::AppHandle,
    info: &ProcessInfo,
    status: RunStatus,
    exit_code: Option<i32>,
) {
    if let Some(run_id) = &info.run_id {
        finish_run_record(handle, run_id, status, exit_code);
    }
}

fn run_status_from_exit(status: &ExitStatus) -> RunStatus {
    if status.success() {
        RunStatus::Success
    } else {
        RunStatus::Failed
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

fn should_keep_monitoring_after_wait_error(pid: Option<u32>) -> bool {
    pid.map(is_process_alive).unwrap_or(false)
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

    fn test_run(app_id: &str, id: &str, started_at: u64, status: RunStatus) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            app_id: app_id.to_string(),
            app_name: app_id.to_string(),
            item_type: ItemType::Task,
            status,
            pid: None,
            exit_code: None,
            started_at,
            finished_at: Some(started_at + 1),
            log_path: format!("/tmp/{id}.log"),
            trigger: RunTrigger::Manual,
        }
    }

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
        assert!(spawn_shell_command("", None, None).is_err());
    }

    #[test]
    fn spawn_shell_command_whitespace_only() {
        assert!(spawn_shell_command("   ", None, None).is_err());
    }

    #[test]
    fn spawn_shell_command_valid() {
        let result = spawn_shell_command("echo hello", None, None);
        assert!(result.is_ok());
        let (mut child, pid) = result.unwrap();
        assert!(pid > 0);
        let _ = child.kill();
    }

    #[test]
    fn format_log_timestamp_is_human_readable() {
        let formatted = format_log_timestamp(now_millis());
        assert!(formatted.contains('-'));
        assert!(formatted.contains(':'));
    }

    #[test]
    fn prune_run_records_keeps_latest_per_app_and_running_records() {
        let mut records = vec![
            test_run("app-1", "old", 1, RunStatus::Success),
            test_run("app-1", "middle", 2, RunStatus::Failed),
            test_run("app-1", "new", 3, RunStatus::Success),
            test_run("app-1", "running", 4, RunStatus::Running),
            test_run("app-2", "other", 1, RunStatus::Success),
        ];

        let removed = prune_run_records(&mut records, 2);

        let kept_ids: HashSet<&str> = records.iter().map(|record| record.id.as_str()).collect();
        let removed_ids: HashSet<&str> = removed.iter().map(|record| record.id.as_str()).collect();
        assert_eq!(kept_ids, HashSet::from(["new", "running", "other"]));
        assert_eq!(removed_ids, HashSet::from(["old", "middle"]));
    }

    #[test]
    fn wait_error_for_live_pid_keeps_monitoring() {
        assert!(should_keep_monitoring_after_wait_error(Some(
            std::process::id()
        )));
    }

    #[test]
    fn wait_error_without_pid_marks_process_lost() {
        assert!(!should_keep_monitoring_after_wait_error(None));
    }

    #[test]
    fn resolve_working_directory_accepts_existing_directory() {
        let cwd = std::env::current_dir().unwrap();
        let result = resolve_working_directory(Some(cwd.to_string_lossy().as_ref())).unwrap();
        assert_eq!(result.unwrap(), cwd);
    }

    #[test]
    fn resolve_working_directory_rejects_missing_directory() {
        let missing = std::env::temp_dir().join(format!("qqr-missing-{}", now_millis()));
        assert!(resolve_working_directory(Some(missing.to_string_lossy().as_ref())).is_err());
    }
}
