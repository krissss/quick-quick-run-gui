#[cfg(target_os = "macos")]
mod dock;
mod html_title;
mod process;
mod tray;
mod url_check;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, TimeZone, Timelike};
use chrono_tz::Tz;
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::{Listener, RunEvent};
use tauri_plugin_store::StoreExt;

use html_title::extract_html_title;
use process::{
    append_run_record, clear_run_records, create_log_path, create_run_id, get_run_records,
    kill_app_process, latest_log_path_for_app, now_millis, persist_session,
    prune_run_records_for_retention, read_log_retention_limit, read_log_tail,
    restore_persisted_sessions, spawn_process_monitor, spawn_shell_command, window_label_for,
    AppState, AppWindowInfo, ItemType, PersistedSession, ProcessInfo, RunRecord, RunStatus,
    RunTrigger,
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            get_app_log_runs,
            clear_app_logs,
            prune_log_records,
            get_recent_runs,
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
                        if hide_dock_on_close_enabled(&handle) {
                            let _ = dock::hide_dock_icon();
                        }
                    }
                });
            }

            // 恢复主窗口保存的位置（逻辑坐标）
            if let Some(window) = app.get_webview_window("main") {
                if let Some(state) = load_window_state(app.handle(), "main") {
                    let pos =
                        tauri::Position::Logical(tauri::LogicalPosition::new(state.x, state.y));
                    let size =
                        tauri::Size::Logical(tauri::LogicalSize::new(state.width, state.height));
                    let _ = window.set_size(size);
                    let _ = window.set_position(pos);
                }
            }

            restore_persisted_sessions(app.handle());
            start_scheduler(app.handle());

            // 设置系统托盘（macOS 菜单栏图标）
            #[cfg(target_os = "macos")]
            {
                tray::setup_tray(app.handle());

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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, RunEvent::Reopen { .. }) {
                show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

// ── IPC 命令 ──

/// launch_app_window 返回值
#[derive(serde::Serialize)]
struct LaunchResult {
    message: String,
    pid: Option<u32>,
    run_id: Option<String>,
}

#[derive(serde::Serialize)]
struct ClearLogsResult {
    removed: usize,
}

/// 启动应用并在新窗口中运行
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn launch_app_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    app_id: String,
    command: String,
    working_directory: String,
    url: String,
    width: f64,
    height: f64,
    app_name: String,
    item_type: Option<ItemType>,
    launch_trigger: Option<RunTrigger>,
    bg_r: u8,
    bg_g: u8,
    bg_b: u8,
) -> Result<LaunchResult, String> {
    let item_type = item_type.unwrap_or_default();
    let launch_trigger = launch_trigger.unwrap_or(RunTrigger::Manual);
    if item_type == ItemType::Service || item_type == ItemType::Task {
        return launch_command_item(
            &app,
            item_type,
            app_id,
            app_name,
            command,
            working_directory,
            launch_trigger,
        );
    }

    let window_label = window_label_for(&app_id);
    let window_info = AppWindowInfo {
        url: url.clone(),
        width,
        height,
        app_name: app_name.clone(),
        bg_r,
        bg_g,
        bg_b,
    };

    // 如果窗口已存在，取消最小化并聚焦
    if let Some(existing) = app.get_webview_window(&window_label) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(LaunchResult {
            message: "窗口已存在，已聚焦".into(),
            pid: None,
            run_id: None,
        });
    }

    // 先杀掉同 app_id 的旧进程
    kill_app_process(&app, &app_id);

    let has_command = !command.trim().is_empty();

    if !has_command {
        // 无命令：直接创建窗口
        let logs = Arc::new(Mutex::new(Vec::new()));
        let _ = create_app_window(&app, &app_id, &window_info)?;

        recover_lock(&state.processes).insert(
            app_id.clone(),
            ProcessInfo {
                child: None,
                pid: None,
                log_path: None,
                logs,
                item_type: ItemType::Web,
                run_id: None,
                window: Some(window_info),
            },
        );
        let _ = app.emit("app-launched", app_id.clone());
        let _ = app.emit("app-window-opened", app_id);
        return Ok(LaunchResult {
            message: "窗口已打开".into(),
            pid: None,
            run_id: None,
        });
    }

    // 有命令：启动进程，立即返回，后台等待 URL 后创建窗口
    let log_path = create_log_path(&app, &app_id)?;
    let (child, pid) =
        spawn_shell_command(&command, Some(working_directory.as_str()), Some(&log_path))?;
    let run_id = create_run_id(&app_id);
    let started_at = now_millis();
    let logs = Arc::new(Mutex::new(Vec::new()));

    // 存入 HashMap + emit，让前端立即看到日志
    recover_lock(&state.processes).insert(
        app_id.clone(),
        ProcessInfo {
            child: Some(child),
            pid: Some(pid),
            log_path: Some(log_path.clone()),
            logs,
            item_type: ItemType::Web,
            run_id: Some(run_id.clone()),
            window: Some(window_info.clone()),
        },
    );
    append_run_record(
        &app,
        RunRecord {
            id: run_id.clone(),
            app_id: app_id.clone(),
            app_name: app_name.clone(),
            item_type: ItemType::Web,
            status: RunStatus::Running,
            pid: Some(pid),
            exit_code: None,
            started_at,
            finished_at: None,
            log_path: log_path.to_string_lossy().to_string(),
            trigger: launch_trigger,
        },
    );
    persist_session(
        &app,
        PersistedSession {
            app_id: app_id.clone(),
            app_name: app_name.clone(),
            item_type: ItemType::Web,
            command: command.clone(),
            working_directory: working_directory.clone(),
            url: url.clone(),
            pid,
            log_path: log_path.to_string_lossy().to_string(),
            started_at,
            run_id: Some(run_id.clone()),
            window: Some(window_info.clone()),
        },
    );
    let _ = app.emit("app-launched", app_id.clone());

    // 启动进程退出监控
    spawn_process_monitor(&app, &app_id);

    // 后台任务：等待 URL 可达 → 创建窗口
    let app_bg = app.clone();
    let app_id_bg = app_id.clone();
    let url_bg = url.clone();
    let window_info_bg = window_info.clone();
    tauri::async_runtime::spawn(async move {
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
            let _ = app_bg.emit(
                "app-launch-failed",
                serde_json::json!({
                    "app_id": app_id_bg,
                    "reason": "timeout",
                }),
            );
            kill_app_process(&app_bg, &app_id_bg);
            return;
        }

        // 创建窗口
        let webview_window = match create_app_window(&app_bg, &app_id_bg, &window_info_bg) {
            Ok(w) => w,
            Err(e) => {
                let _ = app_bg.emit(
                    "app-launch-failed",
                    serde_json::json!({
                        "app_id": app_id_bg,
                        "reason": e,
                    }),
                );
                kill_app_process(&app_bg, &app_id_bg);
                return;
            }
        };

        // 设置窗口标题
        let _ = set_window_title_inner(&webview_window, &url_bg).await;

        let _ = app_bg.emit("app-window-opened", app_id_bg);
    });

    Ok(LaunchResult {
        message: "进程已启动".into(),
        pid: Some(pid),
        run_id: Some(run_id),
    })
}

fn launch_command_item(
    app: &tauri::AppHandle,
    item_type: ItemType,
    app_id: String,
    app_name: String,
    command: String,
    working_directory: String,
    trigger: RunTrigger,
) -> Result<LaunchResult, String> {
    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }

    if item_type == ItemType::Task {
        let already_running = app
            .try_state::<AppState>()
            .map(|state| recover_lock(&state.processes).contains_key(&app_id))
            .unwrap_or(false);
        if already_running {
            return Ok(LaunchResult {
                message: "任务正在运行".into(),
                pid: None,
                run_id: None,
            });
        }
    } else {
        kill_app_process(app, &app_id);
    }

    let log_path = create_log_path(app, &app_id)?;
    let (child, pid) =
        spawn_shell_command(&command, Some(working_directory.as_str()), Some(&log_path))?;
    let run_id = create_run_id(&app_id);
    let started_at = now_millis();
    let logs = Arc::new(Mutex::new(Vec::new()));

    let state = app.state::<AppState>();
    recover_lock(&state.processes).insert(
        app_id.clone(),
        ProcessInfo {
            child: Some(child),
            pid: Some(pid),
            log_path: Some(log_path.clone()),
            logs,
            item_type,
            run_id: Some(run_id.clone()),
            window: None,
        },
    );

    append_run_record(
        app,
        RunRecord {
            id: run_id.clone(),
            app_id: app_id.clone(),
            app_name: app_name.clone(),
            item_type,
            status: RunStatus::Running,
            pid: Some(pid),
            exit_code: None,
            started_at,
            finished_at: None,
            log_path: log_path.to_string_lossy().to_string(),
            trigger,
        },
    );
    persist_session(
        app,
        PersistedSession {
            app_id: app_id.clone(),
            app_name,
            item_type,
            command,
            working_directory,
            url: String::new(),
            pid,
            log_path: log_path.to_string_lossy().to_string(),
            started_at,
            run_id: Some(run_id.clone()),
            window: None,
        },
    );

    let _ = app.emit("app-launched", app_id.clone());
    spawn_process_monitor(app, &app_id);

    let message = if item_type == ItemType::Task {
        "任务已启动"
    } else {
        "服务已启动"
    };
    Ok(LaunchResult {
        message: message.into(),
        pid: Some(pid),
        run_id: Some(run_id),
    })
}

#[derive(serde::Serialize)]
struct RunningAppInfo {
    app_id: String,
    pid: Option<u32>,
    item_type: ItemType,
}

/// 获取当前运行的 app ID 列表
#[tauri::command]
fn get_running_apps(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RunningAppInfo>, String> {
    restore_persisted_sessions(&app);
    Ok(recover_lock(&state.processes)
        .iter()
        .map(|(app_id, info)| RunningAppInfo {
            app_id: app_id.clone(),
            pid: info.pid,
            item_type: info.item_type,
        })
        .collect())
}

/// 获取指定应用的日志缓冲
#[tauri::command]
fn get_app_logs(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    app_id: String,
    run_id: Option<String>,
) -> Result<Vec<String>, String> {
    if let Some(run_id) = run_id {
        let path = get_run_records(&app, Some(&app_id), 500)
            .into_iter()
            .find(|record| record.id == run_id)
            .map(|record| record.log_path);
        return Ok(path
            .map(|path| read_log_tail(std::path::Path::new(&path), 2000))
            .unwrap_or_default());
    }

    let processes = recover_lock(&state.processes);
    if let Some(info) = processes.get(&app_id) {
        if let Some(path) = &info.log_path {
            return Ok(read_log_tail(path, 2000));
        }
        Ok(recover_lock(&info.logs).clone())
    } else if let Some(path) = latest_log_path_for_app(&app, &app_id) {
        Ok(read_log_tail(&path, 2000))
    } else {
        Ok(vec![])
    }
}

/// 获取指定应用最近运行记录，用于日志历史选择
#[tauri::command]
fn get_app_log_runs(
    app: tauri::AppHandle,
    app_id: String,
    limit: Option<usize>,
) -> Result<Vec<RunRecord>, String> {
    let limit = limit
        .unwrap_or_else(|| read_log_retention_limit(&app))
        .clamp(1, 200);
    Ok(get_run_records(&app, Some(&app_id), limit))
}

/// 清理指定应用的历史日志；run_ids 为空时清理全部已结束日志
#[tauri::command]
fn clear_app_logs(
    app: tauri::AppHandle,
    app_id: String,
    run_ids: Option<Vec<String>>,
) -> Result<ClearLogsResult, String> {
    let removed = clear_run_records(&app, &app_id, run_ids);
    let _ = app.emit("app-logs-cleared", app_id);
    Ok(ClearLogsResult { removed })
}

/// 按当前设置裁剪历史日志记录
#[tauri::command]
fn prune_log_records(app: tauri::AppHandle) -> Result<ClearLogsResult, String> {
    Ok(ClearLogsResult {
        removed: prune_run_records_for_retention(&app),
    })
}

/// 获取最近运行记录
#[tauri::command]
fn get_recent_runs(app: tauri::AppHandle) -> Result<Vec<RunRecord>, String> {
    Ok(get_run_records(&app, None, 500))
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
    show_or_create_app_window(&app, &app_id)
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = dock::show_dock_icon();
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub(crate) fn show_or_create_app_window(
    app: &tauri::AppHandle,
    app_id: &str,
) -> Result<(), String> {
    let label = window_label_for(app_id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let window_info = app.try_state::<AppState>().and_then(|state| {
        recover_lock(&state.processes)
            .get(app_id)
            .and_then(|info| info.window.clone())
    });

    if let Some(info) = window_info {
        let win = create_app_window(app, app_id, &info)?;
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}

/// 前端通知应用列表已更新，重建托盘菜单
#[tauri::command]
fn notify_apps_updated(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    tray::rebuild_tray_menu(&_app);
    Ok(())
}

/// 在系统默认浏览器中打开 URL（内部辅助）
fn open_url_in_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();

    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();

    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", url])
        .spawn();
}

/// 在系统默认浏览器中打开 URL（IPC 命令）
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    open_url_in_browser(&url);
    Ok(())
}

// ── 定时任务 ──

#[derive(Clone, serde::Deserialize)]
struct StoredRunItem {
    id: String,
    name: String,
    #[serde(default, rename = "type")]
    item_type: ItemType,
    #[serde(default)]
    command: String,
    #[serde(default, rename = "workingDirectory")]
    working_directory: String,
    #[serde(default)]
    profiles: Vec<StoredProfile>,
    #[serde(default, rename = "activeProfileId")]
    active_profile_id: String,
    #[serde(default)]
    schedule: ScheduleConfig,
}

#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfile {
    #[serde(default)]
    id: String,
    #[serde(default)]
    values: HashMap<String, String>,
}

impl StoredRunItem {
    fn active_profile(&self) -> Option<&StoredProfile> {
        self.profiles
            .iter()
            .find(|profile| profile.id == self.active_profile_id)
    }

    fn effective_command(&self) -> String {
        build_command_with_profile(
            &self.command,
            self.active_profile().map(|profile| &profile.values),
        )
    }

    fn effective_working_directory(&self) -> String {
        self.working_directory.clone()
    }
}

#[derive(Clone, PartialEq)]
enum CommandParamType {
    Text,
    Bool,
}

#[derive(Clone, PartialEq)]
enum CommandParamKind {
    Option,
    Argument,
}

#[derive(Clone)]
struct CommandParam {
    key: String,
    kind: CommandParamKind,
    param_type: CommandParamType,
    default_value: String,
}

#[cfg(test)]
fn parse_command_signature(command: &str) -> (String, Vec<CommandParam>) {
    let mut params = Vec::new();
    let mut base = String::new();
    let mut cursor = 0;

    while let Some(relative_start) = command[cursor..].find('{') {
        let start = cursor + relative_start;
        let body_start = start + 1;
        let Some(relative_end) = command[body_start..].find('}') else {
            break;
        };
        let end = body_start + relative_end;
        let signature = &command[body_start..end];
        let Some(param) = parse_signature_block(signature) else {
            base.push_str(&command[cursor..=end]);
            cursor = end + 1;
            continue;
        };

        base.push_str(&command[cursor..start]);
        if param.kind == CommandParamKind::Argument {
            base.push_str(&param.default_value);
        } else {
            base.push(' ');
        }
        params.push(param);
        cursor = end + 1;
    }

    base.push_str(&command[cursor..]);
    let base_command = base.split_whitespace().collect::<Vec<_>>().join(" ");
    (base_command, params)
}

fn parse_signature_block(signature: &str) -> Option<CommandParam> {
    let (kind, rest) = if let Some(rest) = signature.strip_prefix("--") {
        (CommandParamKind::Option, rest)
    } else {
        (CommandParamKind::Argument, signature)
    };
    let key_len = rest
        .bytes()
        .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
        .count();
    if key_len == 0 {
        return None;
    }

    let key = rest[..key_len].to_string();
    let tail = &rest[key_len..];
    if let Some(value_tail) = tail.strip_prefix('=') {
        let default_value = split_signature_description(value_tail).0.trim().to_string();
        let param_type = if kind == CommandParamKind::Option
            && matches!(
                default_value.trim().to_ascii_lowercase().as_str(),
                "true" | "false"
            ) {
            CommandParamType::Bool
        } else {
            CommandParamType::Text
        };
        return Some(CommandParam {
            key,
            kind,
            param_type,
            default_value,
        });
    }

    let trimmed_tail = tail.trim_start();
    if kind == CommandParamKind::Option
        && (trimmed_tail.is_empty()
            || trimmed_tail.starts_with(':')
            || trimmed_tail.starts_with('：'))
    {
        return Some(CommandParam {
            key,
            kind,
            param_type: CommandParamType::Bool,
            default_value: "false".to_string(),
        });
    }

    None
}

fn split_signature_description(value: &str) -> (&str, Option<&str>) {
    for (index, ch) in value.char_indices() {
        if (ch == ':' || ch == '：')
            && value[..index]
                .chars()
                .last()
                .is_some_and(char::is_whitespace)
        {
            return (&value[..index], Some(value[index + ch.len_utf8()..].trim()));
        }
    }
    (value, None)
}

fn is_truthy_param_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "yes"
    )
}

fn build_command_with_profile(command: &str, values: Option<&HashMap<String, String>>) -> String {
    let mut option_params = Vec::new();
    let mut command_body = String::new();
    let mut cursor = 0;

    while let Some(relative_start) = command[cursor..].find('{') {
        let start = cursor + relative_start;
        let body_start = start + 1;
        let Some(relative_end) = command[body_start..].find('}') else {
            break;
        };
        let end = body_start + relative_end;
        let signature = &command[body_start..end];
        let Some(param) = parse_signature_block(signature) else {
            command_body.push_str(&command[cursor..=end]);
            cursor = end + 1;
            continue;
        };

        let value = values
            .and_then(|items| items.get(&param.key))
            .map(String::as_str)
            .unwrap_or(&param.default_value);
        command_body.push_str(&command[cursor..start]);
        if param.kind == CommandParamKind::Argument {
            command_body.push_str(value);
        } else {
            command_body.push(' ');
            option_params.push(param);
        }
        cursor = end + 1;
    }
    command_body.push_str(&command[cursor..]);

    let base_command = command_body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut parts = vec![base_command];
    for param in option_params {
        let value = values
            .and_then(|items| items.get(&param.key))
            .map(String::as_str)
            .unwrap_or(&param.default_value);
        match param.param_type {
            CommandParamType::Bool => {
                if is_truthy_param_value(value) {
                    parts.push(format!("--{}", param.key));
                }
            }
            CommandParamType::Text => parts.push(format!("--{}={}", param.key, value)),
        }
    }

    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    cron: String,
    #[serde(default = "default_timezone")]
    timezone: String,
    #[serde(default = "default_missed_policy")]
    missed_policy: String,
    #[serde(default)]
    last_run_at: Option<u64>,
}

fn default_timezone() -> String {
    "Asia/Shanghai".to_string()
}

fn default_missed_policy() -> String {
    "skip".to_string()
}

fn start_scheduler(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        loop {
            run_scheduler_tick(&app);
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
}

fn run_scheduler_tick(app: &tauri::AppHandle) {
    let schedule_state = read_schedule_state(app);
    for item in read_scheduled_items(app) {
        let command = item.effective_command();
        if item.item_type != ItemType::Task || command.trim().is_empty() {
            continue;
        }
        let working_directory = item.effective_working_directory();
        let last_run_at = schedule_state
            .get(&item.id)
            .copied()
            .into_iter()
            .chain(item.schedule.last_run_at)
            .max()
            .unwrap_or_else(now_millis);
        let Some(due_at) = schedule_due_at(&item.schedule, last_run_at) else {
            continue;
        };

        let item_id = item.id.clone();
        let launch_result = launch_command_item(
            app,
            ItemType::Task,
            item.id,
            item.name,
            command,
            working_directory,
            RunTrigger::Schedule,
        );
        if should_advance_schedule_state(&launch_result) {
            set_schedule_last_run_at(app, &item_id, due_at);
        } else if let Err(err) = launch_result {
            eprintln!("定时任务启动失败: {}", err);
        }
    }
}

fn should_advance_schedule_state(result: &Result<LaunchResult, String>) -> bool {
    matches!(result, Ok(result) if result.run_id.is_some())
}

fn read_scheduled_items(app: &tauri::AppHandle) -> Vec<StoredRunItem> {
    let Ok(store) = app.store("qqr-store.json") else {
        return Vec::new();
    };
    let _ = store.reload();
    store
        .get("apps")
        .and_then(|value| serde_json::from_value::<Vec<StoredRunItem>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|item| item.schedule.enabled)
        .collect()
}

fn set_schedule_last_run_at(app: &tauri::AppHandle, app_id: &str, due_at: u64) {
    let Ok(store) = app.store("qqr-store.json") else {
        return;
    };
    let mut state = read_schedule_state(app);
    state.insert(app_id.to_string(), due_at);
    let _ = store.reload();
    store.set(
        "schedule_state",
        serde_json::to_value(state).unwrap_or_default(),
    );
    let _ = store.save();
}

fn read_schedule_state(app: &tauri::AppHandle) -> HashMap<String, u64> {
    let Ok(store) = app.store("qqr-store.json") else {
        return HashMap::new();
    };
    let _ = store.reload();
    store
        .get("schedule_state")
        .and_then(|value| serde_json::from_value::<HashMap<String, u64>>(value).ok())
        .unwrap_or_default()
}

fn schedule_due_at(schedule: &ScheduleConfig, last_run_at: u64) -> Option<u64> {
    schedule_due_at_from_now(schedule, last_run_at, Local::now())
}

fn schedule_due_at_from_now<T: TimeZone>(
    schedule: &ScheduleConfig,
    last_run_at: u64,
    now: DateTime<T>,
) -> Option<u64> {
    let timezone = schedule_timezone(schedule);
    schedule_due_at_at(schedule, last_run_at, now.with_timezone(&timezone))
}

fn schedule_timezone(schedule: &ScheduleConfig) -> Tz {
    schedule
        .timezone
        .parse()
        .unwrap_or(chrono_tz::Asia::Shanghai)
}

fn schedule_due_at_at(
    schedule: &ScheduleConfig,
    last_run_at: u64,
    now: DateTime<Tz>,
) -> Option<u64> {
    if !schedule.enabled || schedule.cron.trim().is_empty() {
        return None;
    }
    let spec = CronSpec::parse(&schedule.cron)?;
    let now_minute = minute_start(now);

    if schedule.missed_policy == "run-once" {
        find_last_due_since(&spec, last_run_at, now_minute)
    } else {
        let due_at = now_minute.timestamp_millis() as u64;
        if due_at > last_run_at && spec.matches(now_minute) {
            Some(due_at)
        } else {
            None
        }
    }
}

fn minute_start(time: DateTime<Tz>) -> DateTime<Tz> {
    time.timezone()
        .with_ymd_and_hms(
            time.year(),
            time.month(),
            time.day(),
            time.hour(),
            time.minute(),
            0,
        )
        .single()
        .unwrap_or(time)
}

fn find_last_due_since(spec: &CronSpec, last_run_at: u64, now_minute: DateTime<Tz>) -> Option<u64> {
    let lower = now_minute
        .timezone()
        .timestamp_millis_opt(last_run_at as i64)
        .single()
        .map(minute_start)
        .unwrap_or(now_minute);
    let mut cursor = now_minute;
    let max_lookback = cursor - ChronoDuration::days(32);
    while cursor > lower && cursor >= max_lookback {
        if spec.matches(cursor) {
            let due_at = cursor.timestamp_millis() as u64;
            if due_at > last_run_at {
                return Some(due_at);
            }
        }
        cursor -= ChronoDuration::minutes(1);
    }
    None
}

struct CronSpec {
    minutes: CronField,
    hours: CronField,
    days: CronField,
    months: CronField,
    weekdays: CronField,
}

impl CronSpec {
    fn parse(value: &str) -> Option<Self> {
        let parts: Vec<&str> = value.split_whitespace().collect();
        if parts.len() != 5 {
            return None;
        }
        Some(Self {
            minutes: CronField::parse(parts[0], 0, 59, false)?,
            hours: CronField::parse(parts[1], 0, 23, false)?,
            days: CronField::parse(parts[2], 1, 31, false)?,
            months: CronField::parse(parts[3], 1, 12, false)?,
            weekdays: CronField::parse(parts[4], 0, 7, true)?,
        })
    }

    fn matches(&self, time: DateTime<Tz>) -> bool {
        let weekday = time.weekday().num_days_from_sunday();
        self.minutes.matches(time.minute())
            && self.hours.matches(time.hour())
            && self.days.matches(time.day())
            && self.months.matches(time.month())
            && self.weekdays.matches(weekday)
    }
}

struct CronField {
    values: HashSet<u32>,
    sunday_seven: bool,
}

impl CronField {
    fn parse(value: &str, min: u32, max: u32, sunday_seven: bool) -> Option<Self> {
        let mut values = HashSet::new();
        for raw_part in value.split(',') {
            let part = raw_part.trim();
            if part.is_empty() {
                return None;
            }
            let (range_part, step) = if let Some((range, step)) = part.split_once('/') {
                (range, step.parse::<u32>().ok()?)
            } else {
                (part, 1)
            };
            if step == 0 {
                return None;
            }

            let (start, end) = if range_part == "*" {
                (min, max)
            } else if let Some((start, end)) = range_part.split_once('-') {
                (start.parse::<u32>().ok()?, end.parse::<u32>().ok()?)
            } else {
                let single = range_part.parse::<u32>().ok()?;
                (single, single)
            };
            if start < min || end > max || start > end {
                return None;
            }
            let mut current = start;
            while current <= end {
                values.insert(current);
                current = current.saturating_add(step);
                if current == 0 {
                    break;
                }
            }
        }
        Some(Self {
            values,
            sunday_seven,
        })
    }

    fn matches(&self, value: u32) -> bool {
        self.values.contains(&value)
            || (self.sunday_seven && value == 0 && self.values.contains(&7))
    }
}

#[cfg(test)]
mod scheduler_tests {
    use super::*;

    fn test_schedule(cron: &str, missed_policy: &str) -> ScheduleConfig {
        ScheduleConfig {
            enabled: true,
            cron: cron.to_string(),
            timezone: default_timezone(),
            missed_policy: missed_policy.to_string(),
            last_run_at: None,
        }
    }

    fn local_time(
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        minute: u32,
        second: u32,
    ) -> DateTime<Tz> {
        chrono_tz::Asia::Shanghai
            .with_ymd_and_hms(year, month, day, hour, minute, second)
            .single()
            .unwrap()
    }

    fn millis<T: TimeZone>(time: DateTime<T>) -> u64 {
        time.timestamp_millis() as u64
    }

    #[test]
    fn cron_field_supports_steps_ranges_and_lists() {
        let field = CronField::parse("0,10-20/5,*/30", 0, 59, false).unwrap();

        assert!(field.matches(0));
        assert!(field.matches(10));
        assert!(field.matches(15));
        assert!(field.matches(20));
        assert!(field.matches(30));
        assert!(!field.matches(25));
    }

    #[test]
    fn cron_spec_rejects_invalid_values() {
        assert!(CronSpec::parse("* * * *").is_none());
        assert!(CronSpec::parse("60 * * * *").is_none());
        assert!(CronField::parse("*/0", 0, 59, false).is_none());
    }

    #[test]
    fn cron_spec_treats_weekday_seven_as_sunday() {
        let spec = CronSpec::parse("0 9 * * 7").unwrap();

        assert!(spec.matches(local_time(2026, 5, 3, 9, 0, 0)));
        assert!(!spec.matches(local_time(2026, 5, 4, 9, 0, 0)));
    }

    #[test]
    fn schedule_skip_policy_runs_only_current_matching_minute() {
        let schedule = test_schedule("30 9 * * *", "skip");
        let now = local_time(2026, 5, 1, 9, 30, 15);
        let last_run_at = millis(local_time(2026, 5, 1, 9, 29, 0));
        let expected_due_at = millis(local_time(2026, 5, 1, 9, 30, 0));

        assert_eq!(
            schedule_due_at_at(&schedule, last_run_at, now),
            Some(expected_due_at)
        );
        assert_eq!(
            schedule_due_at_at(
                &schedule,
                expected_due_at,
                local_time(2026, 5, 1, 9, 30, 30)
            ),
            None
        );
    }

    #[test]
    fn schedule_skip_policy_does_not_backfill_missed_runs() {
        let schedule = test_schedule("0 9 * * *", "skip");
        let now = local_time(2026, 5, 1, 12, 0, 0);
        let last_run_at = millis(local_time(2026, 4, 30, 8, 0, 0));

        assert_eq!(schedule_due_at_at(&schedule, last_run_at, now), None);
    }

    #[test]
    fn schedule_run_once_policy_backfills_latest_due_minute() {
        let schedule = test_schedule("0 9 * * *", "run-once");
        let now = local_time(2026, 5, 1, 12, 0, 0);
        let last_run_at = millis(local_time(2026, 4, 30, 8, 0, 0));
        let expected_due_at = millis(local_time(2026, 5, 1, 9, 0, 0));

        assert_eq!(
            schedule_due_at_at(&schedule, last_run_at, now),
            Some(expected_due_at)
        );
    }

    #[test]
    fn schedule_disabled_returns_none() {
        let mut schedule = test_schedule("* * * * *", "skip");
        schedule.enabled = false;

        assert_eq!(
            schedule_due_at_at(&schedule, 0, local_time(2026, 5, 1, 9, 0, 0)),
            None
        );
    }

    #[test]
    fn schedule_uses_configured_timezone() {
        let mut schedule = test_schedule("0 9 * * *", "skip");
        schedule.timezone = "Asia/Tokyo".to_string();
        let now = chrono::Utc
            .with_ymd_and_hms(2026, 5, 1, 0, 0, 30)
            .single()
            .unwrap();
        let last_run_at = millis(
            chrono_tz::Asia::Tokyo
                .with_ymd_and_hms(2026, 4, 30, 9, 0, 0)
                .single()
                .unwrap(),
        );
        let expected_due_at = millis(
            chrono_tz::Asia::Tokyo
                .with_ymd_and_hms(2026, 5, 1, 9, 0, 0)
                .single()
                .unwrap(),
        );

        assert_eq!(
            schedule_due_at_from_now(&schedule, last_run_at, now),
            Some(expected_due_at)
        );
    }

    #[test]
    fn schedule_invalid_timezone_falls_back_to_shanghai() {
        let mut schedule = test_schedule("0 9 * * *", "skip");
        schedule.timezone = "Not/AZone".to_string();
        let now = chrono::Utc
            .with_ymd_and_hms(2026, 5, 1, 1, 0, 30)
            .single()
            .unwrap();
        let last_run_at = millis(local_time(2026, 4, 30, 9, 0, 0));
        let expected_due_at = millis(local_time(2026, 5, 1, 9, 0, 0));

        assert_eq!(
            schedule_due_at_from_now(&schedule, last_run_at, now),
            Some(expected_due_at)
        );
    }

    #[test]
    fn schedule_state_advances_only_after_real_launch() {
        let launched = Ok(LaunchResult {
            message: "任务已启动".to_string(),
            pid: Some(1000),
            run_id: Some("run-1".to_string()),
        });
        let already_running = Ok(LaunchResult {
            message: "任务正在运行".to_string(),
            pid: None,
            run_id: None,
        });
        let failed = Err("启动命令失败".to_string());

        assert!(should_advance_schedule_state(&launched));
        assert!(!should_advance_schedule_state(&already_running));
        assert!(!should_advance_schedule_state(&failed));
    }

    #[test]
    fn builds_command_from_active_profile_values() {
        let mut values = HashMap::new();
        values.insert("account".to_string(), "demo".to_string());
        values.insert("headless".to_string(), "true".to_string());

        let item = StoredRunItem {
            id: "task-1".to_string(),
            name: "Task".to_string(),
            item_type: ItemType::Task,
            command: "pnpm dev {account= : 账号} {--headless}".to_string(),
            working_directory: "/repo/default".to_string(),
            profiles: vec![StoredProfile {
                id: "profile-1".to_string(),
                values,
            }],
            active_profile_id: "profile-1".to_string(),
            schedule: test_schedule("* * * * *", "skip"),
        };

        assert_eq!(item.effective_command(), "pnpm dev demo --headless");
        assert_eq!(item.effective_working_directory(), "/repo/default");
    }

    #[test]
    fn builds_command_from_signature_defaults() {
        let (base_command, params) = parse_command_signature("echo {name= ： who}");
        assert_eq!(base_command, "echo");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].key, "name");
        assert!(params[0].kind == CommandParamKind::Argument);

        assert_eq!(
            build_command_with_profile("uv run job.py {--delay=60 : 延迟} {--only=false}", None),
            "uv run job.py --delay=60"
        );
        assert_eq!(
            build_command_with_profile(
                "uv run job.py {--target=hanxueling:79,87 : 目标} {--enabled=true}",
                None
            ),
            "uv run job.py --target=hanxueling:79,87 --enabled"
        );
        assert_eq!(
            build_command_with_profile("echo {name= ： who} {--newline=false}", None),
            "echo"
        );
        let mut values = HashMap::new();
        values.insert("name".to_string(), "demo".to_string());
        assert_eq!(
            build_command_with_profile("echo {name= : who} {--newline=false}", Some(&values)),
            "echo demo"
        );
    }
}

// ── 内部辅助 ──

fn create_app_window(
    app: &tauri::AppHandle,
    app_id: &str,
    info: &AppWindowInfo,
) -> Result<tauri::WebviewWindow, String> {
    let label = window_label_for(app_id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(existing);
    }

    let window_url = build_app_window_url(&info.url);
    let saved_state = load_window_state(app, app_id);

    let mut builder = tauri::WebviewWindowBuilder::new(app, &label, window_url)
        .title(&info.app_name)
        .background_color(tauri::utils::config::Color(
            info.bg_r, info.bg_g, info.bg_b, 255,
        ))
        .on_new_window(move |url, _features| {
            open_url_in_browser(url.as_str());
            tauri::webview::NewWindowResponse::Deny
        });

    if let Some(state) = saved_state {
        builder = builder
            .inner_size(state.width, state.height)
            .position(state.x, state.y);
    } else {
        builder = builder.inner_size(info.width, info.height).center();
    }

    let webview_window = builder
        .build()
        .map_err(|e| format!("创建窗口失败: {}", e))?;

    let app_save = app.clone();
    let app_id_save = app_id.to_string();
    let label_save = label.clone();
    webview_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(win) = app_save.get_webview_window(&label_save) {
                save_window_state(&app_save, &app_id_save, &win);
                let _ = win.minimize();
            }
        }
    });

    Ok(webview_window)
}

async fn set_window_title_inner(window: &tauri::WebviewWindow, url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let title = extract_html_title(&html);

    if let Some(title) = title {
        window
            .set_title(&title)
            .map_err(|e| format!("设置标题失败: {}", e))?;
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
            let _ = store.reload();
            store.set(&key, serde_json::to_value(state).unwrap());
            let _ = store.save();
        }
    }
}

/// 获取保存的窗口状态
fn load_window_state(app: &tauri::AppHandle, app_id: &str) -> Option<WindowState> {
    let key = format!("window_pos:{}", app_id);
    if let Ok(store) = app.store("qqr-store.json") {
        let _ = store.reload();
        if let Some(value) = store.get(&key) {
            if let Ok(state) = serde_json::from_value::<WindowState>(value) {
                return Some(state);
            }
        }
    }
    None
}

fn hide_dock_on_close_enabled(app: &tauri::AppHandle) -> bool {
    app.store("qqr-store.json")
        .ok()
        .and_then(|store| {
            let _ = store.reload();
            store.get("hide_dock_on_close")
        })
        .and_then(|value| serde_json::from_value::<bool>(value).ok())
        .unwrap_or(false)
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
        let path = format!("app-window.html?url={}", urlencoding::encode(target_url),);
        tauri::WebviewUrl::App(path.into())
    }
}
