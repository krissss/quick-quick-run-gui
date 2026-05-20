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
    use super::{classify_process_roles, parse_lsof_field_output, PortProcessInfo};

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
