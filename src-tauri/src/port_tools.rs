#[cfg(target_os = "windows")]
use std::collections::HashMap;
use std::collections::HashSet;
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, serde::Serialize)]
pub struct PortProcessInfo {
    pub pid: u32,
    pub command: String,
    pub full_command: String,
    pub parent_pid: Option<u32>,
    pub process_role: String,
    pub user: String,
    pub protocol: String,
    pub address: String,
    pub port: u16,
    pub raw: String,
}

pub fn inspect_named_processes(query: &str) -> Result<Vec<PortProcessInfo>, String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Err("进程名称不能为空".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        inspect_named_processes_windows(&query)
    }

    #[cfg(not(target_os = "windows"))]
    {
        inspect_named_processes_unix(&query)
    }
}

pub fn inspect_port_processes(port: u16) -> Result<Vec<PortProcessInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        inspect_port_processes_windows(port)
    }

    #[cfg(not(target_os = "windows"))]
    {
        inspect_port_processes_unix(port)
    }
}

pub fn kill_process(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("PID 无效".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 taskkill 失败: {}", e))?;
        if output.status.success() {
            wait_until_process_exited(pid, Duration::from_millis(1500))?;
            return Ok(());
        }
        return Err(command_error("taskkill", &output));
    }

    #[cfg(not(target_os = "windows"))]
    {
        signal_process(pid, "TERM")?;
        if wait_until_process_exited(pid, Duration::from_millis(1500)).is_ok() {
            return Ok(());
        }
        signal_process(pid, "KILL")?;
        wait_until_process_exited(pid, Duration::from_millis(1500))
    }
}

pub fn kill_port_process(port: u16, pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("PID 无效".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 taskkill 失败: {}", e))?;
        if output.status.success() {
            wait_until_port_released(port, pid, Duration::from_millis(1200))?;
            return Ok(());
        }
        return Err(command_error("taskkill", &output));
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(process_group_id) = read_process_group_id(pid) {
            let current_process_group_id = read_process_group_id(std::process::id());
            if current_process_group_id != Some(process_group_id)
                && signal_process_group(process_group_id, "TERM").is_ok()
            {
                if wait_until_port_released(port, pid, Duration::from_millis(1500)).is_ok() {
                    return Ok(());
                }
                signal_process_group(process_group_id, "KILL")?;
                wait_until_port_released(port, pid, Duration::from_millis(1500))?;
                return Ok(());
            }
        }

        signal_process(pid, "TERM")?;
        if wait_until_port_released(port, pid, Duration::from_millis(1500)).is_ok() {
            return Ok(());
        }
        signal_process(pid, "KILL")?;
        wait_until_port_released(port, pid, Duration::from_millis(1500))
    }
}

fn wait_until_process_exited(pid: u32, timeout: Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if read_process_details(pid).is_none() {
            return Ok(());
        }
        sleep(Duration::from_millis(150));
    }
    Err(format!("PID {} 仍在运行，请检查权限或自动重启进程", pid))
}

#[cfg(not(target_os = "windows"))]
fn signal_process(pid: u32, signal: &str) -> Result<(), String> {
    let output = Command::new("kill")
        .args([format!("-{}", signal), pid.to_string()])
        .output()
        .map_err(|e| format!("执行 kill -{} 失败: {}", signal, e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&format!("kill -{}", signal), &output))
    }
}

#[cfg(not(target_os = "windows"))]
fn signal_process_group(process_group_id: u32, signal: &str) -> Result<(), String> {
    let target = format!("-{}", process_group_id);
    let output = Command::new("kill")
        .args([format!("-{}", signal), target])
        .output()
        .map_err(|e| format!("执行 kill -{} 进程组失败: {}", signal, e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error(&format!("kill -{} 进程组", signal), &output))
    }
}

fn wait_until_port_released(port: u16, pid: u32, timeout: Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    let mut listeners = Vec::new();
    while start.elapsed() < timeout {
        listeners = inspect_port_processes(port)?;
        if !listeners.iter().any(|process| process.pid == pid) {
            return Ok(());
        }
        sleep(Duration::from_millis(150));
    }
    let active_pids = listeners
        .iter()
        .map(|process| process.pid.to_string())
        .collect::<Vec<_>>()
        .join(", ");
    if active_pids.is_empty() {
        Err(format!("PID {} 仍在监听端口 {}", pid, port))
    } else {
        Err(format!(
            "端口 {} 仍被 PID {} 监听，请检查权限或自动重启进程",
            port, active_pids
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn inspect_port_processes_unix(port: u16) -> Result<Vec<PortProcessInfo>, String> {
    let port_filter = format!("-iTCP:{}", port);
    let output = Command::new("lsof")
        .args(["-nP", &port_filter, "-sTCP:LISTEN", "-F", "pcunP"])
        .output()
        .map_err(|e| format!("执行 lsof 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Ok(Vec::new());
        }
        return Err(format!("lsof 查询失败: {}", stderr));
    }

    parse_lsof_field_output(port, &String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(target_os = "windows"))]
fn inspect_named_processes_unix(query: &str) -> Result<Vec<PortProcessInfo>, String> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,user=,comm=,command="])
        .output()
        .map_err(|e| format!("执行 ps 失败: {}", e))?;
    if !output.status.success() {
        return Err(command_error("ps", &output));
    }

    parse_ps_process_output(query, &String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(target_os = "windows"))]
fn parse_ps_process_output(query: &str, output: &str) -> Result<Vec<PortProcessInfo>, String> {
    let mut results = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((pid_text, rest)) = split_first_field(line) else {
            continue;
        };
        let Some(pid) = pid_text.parse::<u32>().ok() else {
            continue;
        };
        let Some((user, rest)) = split_first_field(rest) else {
            continue;
        };
        let Some((command, full_command)) = split_first_field(rest) else {
            continue;
        };
        let full_command = full_command.trim().to_string();
        let command = display_command_name(command, &full_command);
        if !process_matches_query(query, &command, &full_command) {
            continue;
        }
        results.push(build_named_process_info(
            pid,
            command,
            user.to_string(),
            full_command,
            line.to_string(),
        ));
    }

    Ok(classify_process_roles(deduplicate_processes(results)))
}

#[cfg(not(target_os = "windows"))]
fn split_first_field(value: &str) -> Option<(&str, &str)> {
    let value = value.trim_start();
    let split_at = value.find(char::is_whitespace)?;
    let (field, rest) = value.split_at(split_at);
    Some((field, rest.trim_start()))
}

#[cfg(not(target_os = "windows"))]
fn parse_lsof_field_output(port: u16, output: &str) -> Result<Vec<PortProcessInfo>, String> {
    let mut results = Vec::new();
    let mut current_pid: Option<u32> = None;
    let mut current_command = String::new();
    let mut current_user = String::new();
    let mut current_protocol = String::new();

    for line in output.lines() {
        let Some((kind, value)) = line.split_at_checked(1) else {
            continue;
        };
        match kind {
            "p" => {
                current_pid = value.parse::<u32>().ok();
                current_command.clear();
                current_user.clear();
                current_protocol.clear();
            }
            "c" => current_command = value.to_string(),
            "u" => current_user = value.to_string(),
            "P" => current_protocol = value.to_string(),
            "n" => {
                if let Some(pid) = current_pid {
                    results.push(build_process_info(
                        pid,
                        current_command.clone(),
                        current_user.clone(),
                        if current_protocol.is_empty() {
                            "TCP".to_string()
                        } else {
                            current_protocol.clone()
                        },
                        value.to_string(),
                        port,
                        value.to_string(),
                    ));
                }
            }
            _ => {}
        }
    }

    Ok(classify_process_roles(deduplicate_processes(results)))
}

#[cfg(target_os = "windows")]
fn inspect_port_processes_windows(port: u16) -> Result<Vec<PortProcessInfo>, String> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 netstat 失败: {}", e))?;
    if !output.status.success() {
        return Err(command_error("netstat", &output));
    }

    let task_names = windows_task_names()?;
    let mut results = Vec::new();
    let port_suffix = format!(":{}", port);
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 || parts[0] != "TCP" || parts[3] != "LISTENING" {
            continue;
        }
        if !parts[1].ends_with(&port_suffix) {
            continue;
        }
        let Some(pid) = parts[4].parse::<u32>().ok() else {
            continue;
        };
        let command = task_names
            .get(&pid)
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());
        results.push(build_process_info(
            pid,
            command,
            String::new(),
            "TCP".to_string(),
            parts[1].to_string(),
            port,
            line.to_string(),
        ));
    }

    Ok(classify_process_roles(deduplicate_processes(results)))
}

#[cfg(target_os = "windows")]
fn inspect_named_processes_windows(query: &str) -> Result<Vec<PortProcessInfo>, String> {
    let output = Command::new("wmic")
        .args([
            "process",
            "get",
            "ProcessId,Name,CommandLine",
            "/format:csv",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 wmic 失败: {}", e))?;
    if !output.status.success() {
        return Err(command_error("wmic", &output));
    }

    let mut results = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let fields = parse_csv_line(line);
        if fields.len() < 4 || fields[0] == "Node" {
            continue;
        }
        let command = fields[2].trim().to_string();
        let full_command = fields[1].trim().to_string();
        let Some(pid) = fields[3].trim().parse::<u32>().ok() else {
            continue;
        };
        if !process_matches_query(query, &command, &full_command) {
            continue;
        }
        results.push(build_named_process_info(
            pid,
            command,
            String::new(),
            full_command,
            line.to_string(),
        ));
    }

    Ok(classify_process_roles(deduplicate_processes(results)))
}

#[cfg(target_os = "windows")]
fn windows_task_names() -> Result<HashMap<u32, String>, String> {
    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 tasklist 失败: {}", e))?;
    if !output.status.success() {
        return Err(command_error("tasklist", &output));
    }

    let mut names = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let fields = parse_csv_line(line);
        if fields.len() < 2 {
            continue;
        }
        if let Ok(pid) = fields[1].parse::<u32>() {
            names.insert(pid, fields[0].clone());
        }
    }
    Ok(names)
}

#[cfg(target_os = "windows")]
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                current.push('"');
                let _ = chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current);
    fields
}

fn deduplicate_processes(processes: Vec<PortProcessInfo>) -> Vec<PortProcessInfo> {
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for process in processes {
        if seen.insert(process.pid) {
            results.push(process);
        }
    }
    results.sort_by_key(|process| process.pid);
    results
}

fn build_process_info(
    pid: u32,
    command: String,
    user: String,
    protocol: String,
    address: String,
    port: u16,
    raw: String,
) -> PortProcessInfo {
    let process_details = read_process_details(pid);
    let full_command = process_details
        .as_ref()
        .and_then(|details| details.command.clone())
        .unwrap_or_else(|| command.clone());
    let parent_pid = process_details.and_then(|details| details.parent_pid);
    PortProcessInfo {
        pid,
        command,
        full_command,
        parent_pid,
        process_role: String::new(),
        user,
        protocol,
        address,
        port,
        raw,
    }
}

fn build_named_process_info(
    pid: u32,
    command: String,
    user: String,
    full_command: String,
    raw: String,
) -> PortProcessInfo {
    let process_details = read_process_details(pid);
    let parent_pid = process_details.and_then(|details| details.parent_pid);
    PortProcessInfo {
        pid,
        command,
        full_command,
        parent_pid,
        process_role: String::new(),
        user,
        protocol: String::new(),
        address: String::new(),
        port: 0,
        raw,
    }
}

fn process_matches_query(query: &str, command: &str, full_command: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return false;
    }

    if query.chars().count() <= 2 {
        if command_name_matches_short_query(command, &query) {
            return true;
        }
        return executable_name_from_command_line(full_command)
            .is_some_and(|name| command_name_matches_short_query(&name, &query));
    }

    if command.to_lowercase().contains(&query) {
        return true;
    }

    full_command.to_lowercase().contains(&query)
}

fn command_name_matches_short_query(command: &str, query: &str) -> bool {
    command
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
        .filter(|part| !part.is_empty())
        .any(|part| part.to_lowercase().starts_with(query))
}

#[cfg(not(target_os = "windows"))]
fn display_command_name(command: &str, full_command: &str) -> String {
    let command = command.trim();
    let executable_name = executable_name_from_command_line(full_command);
    if command.is_empty() || command.contains('/') || command.contains('\\') {
        return executable_name.unwrap_or_else(|| {
            path_basename(command).unwrap_or_else(|| command.trim_matches('/').to_string())
        });
    }

    if let Some(name) = executable_name {
        if name.len() > command.len() && name.to_lowercase().starts_with(&command.to_lowercase()) {
            return name;
        }
    }

    command.to_string()
}

fn executable_name_from_command_line(full_command: &str) -> Option<String> {
    let full_command = full_command.trim();
    if full_command.is_empty() {
        return None;
    }

    if let Some(name) = macos_bundle_executable_name(full_command) {
        return Some(name);
    }

    path_basename(first_command_token(full_command)?)
}

fn macos_bundle_executable_name(full_command: &str) -> Option<String> {
    let (_, after_marker) = full_command.rsplit_once("/Contents/MacOS/")?;
    let executable = split_macos_executable_from_args(after_marker);
    clean_executable_name(executable)
}

fn split_macos_executable_from_args(value: &str) -> &str {
    let value = value.trim();
    [" --", " -", " /"]
        .iter()
        .filter_map(|delimiter| value.find(delimiter))
        .min()
        .map_or(value, |index| value[..index].trim())
}

fn first_command_token(value: &str) -> Option<&str> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    let mut chars = value.char_indices();
    let (_, first) = chars.next()?;
    if first == '"' || first == '\'' {
        return value[1..].find(first).map(|index| &value[1..1 + index]);
    }

    value.split_whitespace().next()
}

fn path_basename(value: &str) -> Option<String> {
    let value = value
        .trim()
        .trim_matches(|ch| ch == '"' || ch == '\'')
        .trim_end_matches(['/', '\\']);
    clean_executable_name(value.rsplit(['/', '\\']).next()?)
}

fn clean_executable_name(value: &str) -> Option<String> {
    let value = value
        .trim()
        .trim_matches(|ch| ch == '"' || ch == '\'')
        .trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

struct ProcessDetails {
    parent_pid: Option<u32>,
    command: Option<String>,
}

#[cfg(not(target_os = "windows"))]
fn read_process_details(pid: u32) -> Option<ProcessDetails> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "ppid=,command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts = line.splitn(2, char::is_whitespace);
    let parent_pid = parts.next().and_then(|value| value.parse::<u32>().ok());
    let command = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    Some(ProcessDetails {
        parent_pid,
        command,
    })
}

#[cfg(not(target_os = "windows"))]
fn read_process_group_id(pid: u32) -> Option<u32> {
    let output = Command::new("ps")
        .args(["-o", "pgid=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .ok()
}

#[cfg(target_os = "windows")]
fn read_process_details(pid: u32) -> Option<ProcessDetails> {
    let output = Command::new("wmic")
        .args([
            "process",
            "where",
            &format!("ProcessId={}", pid),
            "get",
            "CommandLine,ParentProcessId",
            "/value",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mut parent_pid = None;
    let mut command = None;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(value) = line.strip_prefix("ParentProcessId=") {
            parent_pid = value.trim().parse::<u32>().ok();
        } else if let Some(value) = line.strip_prefix("CommandLine=") {
            let value = value.trim();
            if !value.is_empty() {
                command = Some(value.to_string());
            }
        }
    }
    Some(ProcessDetails {
        parent_pid,
        command,
    })
}

fn classify_process_roles(mut processes: Vec<PortProcessInfo>) -> Vec<PortProcessInfo> {
    let pids: HashSet<u32> = processes.iter().map(|process| process.pid).collect();
    let parent_pids: HashSet<u32> = processes
        .iter()
        .filter_map(|process| process.parent_pid)
        .filter(|parent_pid| pids.contains(parent_pid))
        .collect();

    for process in &mut processes {
        process.process_role = if process
            .parent_pid
            .is_some_and(|parent_pid| pids.contains(&parent_pid))
        {
            "子进程".to_string()
        } else if parent_pids.contains(&process.pid) {
            "主进程".to_string()
        } else {
            "独立进程".to_string()
        };
    }

    processes
}

fn command_error(command: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        format!("{} 失败: {}", command, stderr)
    } else if !stdout.is_empty() {
        format!("{} 失败: {}", command, stdout)
    } else {
        format!("{} 失败，退出码 {:?}", command, output.status.code())
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(target_os = "windows"))]
    use super::{
        classify_process_roles, parse_lsof_field_output, parse_ps_process_output, PortProcessInfo,
    };

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parses_lsof_field_output() {
        let output = "p12345\ncnode\nu501\nPTCP\nn127.0.0.1:5891\n";
        let processes = parse_lsof_field_output(5891, output).unwrap();

        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].pid, 12345);
        assert_eq!(processes[0].command, "node");
        assert_eq!(processes[0].process_role, "独立进程");
        assert_eq!(processes[0].user, "501");
        assert_eq!(processes[0].protocol, "TCP");
        assert_eq!(processes[0].address, "127.0.0.1:5891");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn normalizes_truncated_macos_system_process_names() {
        let output = "123 root /System/Library/ /System/Library/ExtensionKit/Extensions/WallpaperAerialsExtension.appex/Contents/MacOS/WallpaperAerialsExtension\n";
        let processes = parse_ps_process_output("wall", output).unwrap();

        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].command, "WallpaperAerialsExtension");
        assert_eq!(
            processes[0].full_command,
            "/System/Library/ExtensionKit/Extensions/WallpaperAerialsExtension.appex/Contents/MacOS/WallpaperAerialsExtension"
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn short_name_search_matches_executable_name() {
        let output = "123 kriss /Users/kriss/.qw /Users/kriss/.qwenpaw/venv/bin/python /Users/kriss/.qwenpaw/venv/bin/qwenpaw app\n";
        let processes = parse_ps_process_output("py", output).unwrap();

        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].command, "python");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn short_name_search_ignores_path_only_matches() {
        let output = "123 root /System/Library/ /System/Library/CoreServices/copyfiled\n";
        let processes = parse_ps_process_output("py", output).unwrap();

        assert!(processes.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn classifies_parent_child_and_standalone_process_roles() {
        let processes = classify_process_roles(vec![
            fake_process(10, None),
            fake_process(20, Some(10)),
            fake_process(30, Some(10)),
            fake_process(40, Some(1)),
        ]);

        assert_eq!(processes[0].process_role, "主进程");
        assert_eq!(processes[1].process_role, "子进程");
        assert_eq!(processes[2].process_role, "子进程");
        assert_eq!(processes[3].process_role, "独立进程");
    }

    #[cfg(not(target_os = "windows"))]
    fn fake_process(pid: u32, parent_pid: Option<u32>) -> PortProcessInfo {
        PortProcessInfo {
            pid,
            command: "php".to_string(),
            full_command: "php start.php".to_string(),
            parent_pid,
            process_role: String::new(),
            user: "501".to_string(),
            protocol: "TCP".to_string(),
            address: "*:5891".to_string(),
            port: 5891,
            raw: "*:5891".to_string(),
        }
    }
}
