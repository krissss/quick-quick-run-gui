#[cfg(target_os = "macos")]
mod dock;
mod html_title;
mod port_tools;
mod process;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod tray;
mod url_check;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, TimeZone, Timelike};
use chrono_tz::Tz;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
use tauri::Listener;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

use html_title::{extract_favicon_href, extract_html_title};
use port_tools::{
    inspect_named_processes, inspect_port_processes, kill_port_process, kill_process,
    PortProcessInfo,
};
use process::{
    append_run_record, clear_run_records, create_log_path, create_run_id, detach_app_process,
    get_run_records, kill_app_process, latest_log_path_for_app, now_millis, persist_session,
    prune_run_records_for_retention, read_log_retention_limit, read_log_tail,
    resolve_managed_process_pid, restore_persisted_sessions, spawn_process_monitor,
    spawn_recovered_process_monitor, spawn_restore_persisted_sessions, spawn_shell_command,
    stop_detached_process, window_label_for, AppState, AppWindowInfo, ItemType, PersistedSession,
    ProcessInfo, RunRecord, RunStatus, RunTrigger,
};
use url_check::{check_url_inner, check_url_quick};

#[cfg(debug_assertions)]
const DEV_SERVER_URL: &str = "http://localhost:47891";

static PATH_ENV_INIT: OnceLock<Result<(), String>> = OnceLock::new();

/// Lock a Mutex, recovering from poison by taking the guard.
fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn initialize_path_env() -> Result<(), String> {
    PATH_ENV_INIT
        .get_or_init(|| fix_path_env::fix_all_vars().map_err(|e| e.to_string()))
        .clone()
}

fn ensure_path_env_ready() {
    if let Err(e) = initialize_path_env() {
        eprintln!("fix_path_env failed: {e}");
    }
}

fn should_wait_for_path_env(trigger: RunTrigger) -> bool {
    matches!(
        trigger,
        RunTrigger::Schedule | RunTrigger::AutoRestart | RunTrigger::Retry
    )
}

fn spawn_path_env_initialization() {
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
        tauri::async_runtime::spawn_blocking(ensure_path_env_ready);
    });
}

fn spawn_main_window_state_restore(handle: &tauri::AppHandle) {
    let handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(900)).await;
        let handle_for_load = handle.clone();
        let state = tauri::async_runtime::spawn_blocking(move || {
            load_window_state(&handle_for_load, "main")
        })
        .await
        .ok()
        .flatten();
        let Some(state) = state else {
            return;
        };
        let Some(window) = handle.get_webview_window("main") else {
            return;
        };
        let pos = tauri::Position::Logical(tauri::LogicalPosition::new(state.x, state.y));
        let size = tauri::Size::Logical(tauri::LogicalSize::new(state.width, state.height));
        let _ = window.set_size(size);
        let _ = window.set_position(pos);
    });
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
            get_web_favicon,
            reconcile_running_records,
            reconcile_running_web_records,
            inspect_port,
            inspect_process_name,
            kill_port_pid,
            kill_process_pid,
            stop_app,
            show_app_window,
            notify_apps_updated,
            open_in_browser,
        ])
        .setup(|app| {
            spawn_path_env_initialization();

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

            // 主窗口先显示，历史位置稍后恢复，避免启动首屏被 store reload 卡住。
            spawn_main_window_state_restore(app.handle());

            start_scheduler(app.handle());

            // 设置系统托盘 / macOS 菜单栏图标
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                tray::setup_tray(app.handle());

                // 监听事件以刷新托盘菜单
                let h1 = app.handle().clone();
                let h2 = app.handle().clone();
                let h3 = app.handle().clone();
                let _ = app.listen("apps-updated", move |_| {
                    tray::rebuild_tray_menu_deferred(&h1);
                });
                let _ = app.listen("app-launched", move |_| {
                    tray::rebuild_tray_menu_deferred(&h2);
                });
                let _ = app.listen("app-stopped", move |_| {
                    tray::rebuild_tray_menu_deferred(&h3);
                });
                let h4 = app.handle().clone();
                let _ = app.listen("running-records-reconciled", move |_| {
                    tray::rebuild_tray_menu_deferred(&h4);
                });
            }

            spawn_restore_persisted_sessions(app.handle());

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

#[derive(serde::Serialize)]
struct KillPortResult {
    message: String,
}

fn latest_running_record_for(
    app: &tauri::AppHandle,
    app_id: &str,
    item_type: ItemType,
    command: &str,
) -> Option<RunRecord> {
    let command = command.trim();
    get_run_records(app, Some(app_id), 5)
        .into_iter()
        .find(|record| {
            record.status == RunStatus::Running
                && record.item_type == item_type
                && record.command.trim() == command
        })
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

    let has_command = !command.trim().is_empty();

    let running_web = {
        let processes = recover_lock(&state.processes);
        processes
            .get(&app_id)
            .filter(|info| info.item_type == ItemType::Web)
            .map(|info| (info.pid, info.run_id.clone()))
    };
    if let Some((pid, run_id)) = running_web {
        return Ok(LaunchResult {
            message: if has_command {
                "应用正在启动，已保留当前进程".into()
            } else {
                "窗口已打开".into()
            },
            pid,
            run_id,
        });
    }

    let quick_recover_record = if has_command {
        latest_running_record_for(&app, &app_id, ItemType::Web, &command)
    } else {
        None
    };
    let quick_recover_record = match quick_recover_record {
        Some(record) if check_url_quick(&url, Duration::from_millis(300)).await => Some(record),
        _ => None,
    };
    if let Some(record) = quick_recover_record {
        let _ = create_app_window(&app, &app_id, &window_info)?;
        recover_lock(&state.processes).insert(
            app_id.clone(),
            ProcessInfo {
                child: None,
                pid: None,
                log_path: Some(PathBuf::from(&record.log_path)),
                logs: Arc::new(Mutex::new(Vec::new())),
                item_type: ItemType::Web,
                run_id: Some(record.id.clone()),
                window: Some(window_info),
                command: command.clone(),
                working_directory: working_directory.clone(),
            },
        );
        let _ = app.emit("app-launched", app_id.clone());
        let _ = app.emit("app-window-opened", app_id.clone());
        return Ok(LaunchResult {
            message: "应用正在运行，已恢复窗口".into(),
            pid: None,
            run_id: Some(record.id),
        });
    }

    // 前台启动路径只做轻量判断；历史 PID 重绑交给后台恢复/手动对账处理。

    // 先杀掉同 app_id 的旧进程
    kill_app_process(&app, &app_id);

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
                command: command.clone(),
                working_directory: working_directory.clone(),
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
    if should_wait_for_path_env(launch_trigger) {
        ensure_path_env_ready();
    }
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
            command: command.clone(),
            working_directory: working_directory.clone(),
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
            command: command.clone(),
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

#[tauri::command]
async fn inspect_port(port: u16) -> Result<Vec<PortProcessInfo>, String> {
    if port == 0 {
        return Err("端口号必须在 1 到 65535 之间".to_string());
    }
    inspect_port_processes(port)
}

#[tauri::command]
async fn inspect_process_name(query: String) -> Result<Vec<PortProcessInfo>, String> {
    inspect_named_processes(&query)
}

#[tauri::command]
async fn kill_port_pid(port: u16, pid: u32) -> Result<KillPortResult, String> {
    if port == 0 {
        return Err("端口号必须在 1 到 65535 之间".to_string());
    }
    let listeners = inspect_port_processes(port)?;
    if !listeners.iter().any(|process| process.pid == pid) {
        return Err(format!("PID {} 当前未监听端口 {}", pid, port));
    }
    kill_port_process(port, pid)?;
    Ok(KillPortResult {
        message: format!("已结束 PID {}（端口 {}）", pid, port),
    })
}

#[tauri::command]
async fn kill_process_pid(query: String, pid: u32) -> Result<KillPortResult, String> {
    let processes = inspect_named_processes(&query)?;
    if !processes.iter().any(|process| process.pid == pid) {
        return Err(format!("PID {} 当前不匹配进程名称 {}", pid, query.trim()));
    }
    kill_process(pid)?;
    Ok(KillPortResult {
        message: format!("已结束 PID {}（名称 {}）", pid, query.trim()),
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
    if should_wait_for_path_env(trigger) {
        ensure_path_env_ready();
    }

    let running_item = app.try_state::<AppState>().and_then(|state| {
        recover_lock(&state.processes)
            .get(&app_id)
            .map(|info| (info.pid, info.run_id.clone()))
    });
    if let Some((pid, run_id)) = running_item {
        if item_type == ItemType::Task {
            return Ok(LaunchResult {
                message: "任务正在运行".into(),
                pid: None,
                run_id: None,
            });
        }
        if should_reuse_running_command_item(item_type, trigger) {
            return Ok(LaunchResult {
                message: "服务正在运行".into(),
                pid,
                run_id,
            });
        }
    }

    if item_type != ItemType::Task {
        if let Some((record, pid)) = get_run_records(app, Some(&app_id), 20)
            .into_iter()
            .find_map(|record| {
                if record.status != RunStatus::Running || record.item_type != item_type {
                    return None;
                }
                record
                    .pid
                    .and_then(|pid| {
                        resolve_managed_process_pid(pid, &command, &working_directory, item_type)
                    })
                    .map(|pid| (record, pid))
            })
        {
            let state = app.state::<AppState>();
            recover_lock(&state.processes).insert(
                app_id.clone(),
                ProcessInfo {
                    child: None,
                    pid: Some(pid),
                    log_path: Some(PathBuf::from(&record.log_path)),
                    logs: Arc::new(Mutex::new(Vec::new())),
                    item_type,
                    run_id: Some(record.id.clone()),
                    window: None,
                    command: command.clone(),
                    working_directory: working_directory.clone(),
                },
            );
            persist_session(
                app,
                PersistedSession {
                    app_id: app_id.clone(),
                    app_name: app_name.clone(),
                    item_type,
                    command: command.clone(),
                    working_directory: working_directory.clone(),
                    url: String::new(),
                    pid,
                    log_path: record.log_path.clone(),
                    started_at: record.started_at,
                    run_id: Some(record.id.clone()),
                    window: None,
                },
            );
            spawn_recovered_process_monitor(app, &app_id);
            let _ = app.emit("app-launched", app_id);
            return Ok(LaunchResult {
                message: "服务正在运行".into(),
                pid: Some(pid),
                run_id: Some(record.id),
            });
        }
    }

    if item_type != ItemType::Task {
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
            command: command.clone(),
            working_directory: working_directory.clone(),
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
            command: command.clone(),
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
fn get_running_apps(state: tauri::State<'_, AppState>) -> Result<Vec<RunningAppInfo>, String> {
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

/// 获取网页 favicon，用于主窗口列表展示
#[tauri::command]
async fn get_web_favicon(url: String) -> Result<Option<String>, String> {
    fetch_web_favicon(&url).await
}

#[tauri::command]
fn reconcile_running_web_records(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    reconcile_running_records(app, state)
}

#[tauri::command]
fn reconcile_running_records(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    restore_persisted_sessions(&app);
    let items = read_stored_items(&app);
    let mut seen_app_ids = HashSet::new();
    for record in get_run_records(&app, None, 500)
        .into_iter()
        .filter(|record| {
            record.status == RunStatus::Running
                && matches!(record.item_type, ItemType::Web | ItemType::Service)
        })
    {
        let Some(pid) = record.pid else {
            continue;
        };
        if seen_app_ids.contains(&record.app_id) {
            continue;
        }
        let Some(item) = items.iter().find(|item| item.id == record.app_id) else {
            continue;
        };
        let command = item.effective_command();
        let working_directory = item.effective_working_directory();
        let Some(live_pid) =
            resolve_managed_process_pid(pid, &command, &working_directory, record.item_type)
        else {
            continue;
        };
        if recover_lock(&state.processes).contains_key(&record.app_id) {
            continue;
        }
        seen_app_ids.insert(record.app_id.clone());
        let window = if record.item_type == ItemType::Web {
            Some(AppWindowInfo {
                url: item.url.clone(),
                width: item.width,
                height: item.height,
                app_name: item.name.clone(),
                bg_r: 255,
                bg_g: 255,
                bg_b: 255,
            })
        } else {
            None
        };
        recover_lock(&state.processes).insert(
            record.app_id.clone(),
            ProcessInfo {
                child: None,
                pid: Some(live_pid),
                log_path: Some(PathBuf::from(&record.log_path)),
                logs: Arc::new(Mutex::new(Vec::new())),
                item_type: record.item_type,
                run_id: Some(record.id.clone()),
                window: window.clone(),
                command: command.clone(),
                working_directory: working_directory.clone(),
            },
        );
        persist_session(
            &app,
            PersistedSession {
                app_id: record.app_id.clone(),
                app_name: record.app_name.clone(),
                item_type: record.item_type,
                command,
                working_directory,
                url: item.url.clone(),
                pid: live_pid,
                log_path: record.log_path.clone(),
                started_at: record.started_at,
                run_id: Some(record.id.clone()),
                window,
            },
        );
        spawn_recovered_process_monitor(&app, &record.app_id);
    }
    let _ = app.emit("running-records-reconciled", ());
    Ok(())
}

/// 停止应用进程（杀掉进程、关闭窗口）
#[tauri::command]
fn stop_app(app: tauri::AppHandle, app_id: String) -> Result<(), String> {
    // 先关闭窗口
    let label = window_label_for(&app_id);
    if let Some(win) = app.get_webview_window(&label) {
        save_window_state(&app, &app_id, &win);
        // 停止应用时强制销毁窗口，避免触发用户关闭窗口的普通生命周期。
        let _ = win.destroy();
    }
    if let Some(info) = detach_app_process(&app, &app_id) {
        if info.pid.is_some() {
            if let Some(run_id) = &info.run_id {
                process::finish_run_record(&app, run_id, RunStatus::Killed, None);
            }
        } else if let Some(run_id) = &info.run_id {
            let _ = app.emit(
                "app-run-unbound",
                serde_json::json!({
                    "app_id": app_id,
                    "run_id": run_id,
                }),
            );
        }
        if info.pid.is_some() {
            process::remove_persisted_session(&app, &app_id);
        }
        let _ = app.emit("app-stopped", app_id.clone());
        if info.pid.is_some() || info.child.is_some() {
            stop_detached_process(app, info);
        }
    } else {
        let _ = app.emit("app-stopped", app_id);
    }
    Ok(())
}

/// 显示/聚焦已运行应用的窗口（取消最小化）
#[tauri::command]
fn show_app_window(app: tauri::AppHandle, app_id: String) -> Result<(), String> {
    show_or_create_app_window(&app, &app_id)
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = dock::show_dock_icon();

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
fn notify_apps_updated(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    tray::rebuild_tray_menu_deferred(&app);

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let _ = app;

    Ok(())
}

/// 在系统默认浏览器中打开 URL（内部辅助）
fn open_url_in_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();

    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
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
    url: String,
    #[serde(default = "default_window_width")]
    width: f64,
    #[serde(default = "default_window_height")]
    height: f64,
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

fn default_window_width() -> f64 {
    1200.0
}

fn default_window_height() -> f64 {
    800.0
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

fn should_reuse_running_command_item(item_type: ItemType, trigger: RunTrigger) -> bool {
    item_type == ItemType::Service && trigger == RunTrigger::Startup
}

fn read_stored_items(app: &tauri::AppHandle) -> Vec<StoredRunItem> {
    let Ok(store) = app.store("qqr-store.json") else {
        return Vec::new();
    };
    let _ = store.reload();
    store
        .get("apps")
        .and_then(|value| serde_json::from_value::<Vec<StoredRunItem>>(value).ok())
        .unwrap_or_default()
}

fn read_scheduled_items(app: &tauri::AppHandle) -> Vec<StoredRunItem> {
    read_stored_items(app)
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
    fn startup_service_reuses_existing_command_item() {
        assert!(should_reuse_running_command_item(
            ItemType::Service,
            RunTrigger::Startup
        ));
        assert!(!should_reuse_running_command_item(
            ItemType::Service,
            RunTrigger::Manual
        ));
        assert!(!should_reuse_running_command_item(
            ItemType::Task,
            RunTrigger::Startup
        ));
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
            url: String::new(),
            width: 1200.0,
            height: 800.0,
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
    let window_save = webview_window.clone();
    webview_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            save_window_state(&app_save, &app_id_save, &window_save);
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

async fn fetch_web_favicon(url: &str) -> Result<Option<String>, String> {
    let base_url = url::Url::parse(url).map_err(|e| format!("URL 无效: {}", e))?;
    if !matches!(base_url.scheme(), "http" | "https") {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    if let Ok(resp) = client.get(base_url.clone()).send().await {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                if let Some(href) = extract_favicon_href(&html) {
                    if let Ok(icon_url) = base_url.join(&href) {
                        if matches!(icon_url.scheme(), "http" | "https") {
                            return Ok(Some(icon_url.to_string()));
                        }
                    }
                }
            }
        }
    }

    Ok(base_url
        .join("/favicon.ico")
        .ok()
        .map(|url| url.to_string()))
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

#[cfg(target_os = "macos")]
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
            "{}/app-window.html?url={}",
            DEV_SERVER_URL,
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
