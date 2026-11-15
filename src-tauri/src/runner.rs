//! 在 .env 环境中运行外部命令（npm / go / node / python / 任意 exe）
//! 子进程继承系统环境 + .env 变量（同名时 .env 覆盖），输出实时回传前端，可随时终止。
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
pub struct RunOutput {
    pub run_id: u32,
    pub line: String,
    pub stream: String, // "out" | "err" | "sys"
}

#[derive(Serialize, Clone)]
pub struct RunExit {
    pub run_id: u32,
    pub code: Option<i32>,
    pub killed: bool,
}

struct RunningChild {
    child: Arc<Mutex<std::process::Child>>,
}

/// 全局运行表：run_id -> 子进程
pub struct RunRegistry(Arc<Mutex<HashMap<u32, RunningChild>>>);

use std::collections::HashMap;

impl RunRegistry {
    pub fn new() -> Self {
        RunRegistry(Arc::new(Mutex::new(HashMap::new())))
    }
}

/// 解析命令行（支持带引号的路径与参数），返回 program + args
fn split_command_line(cmd: &str) -> (String, Vec<String>) {
    let cmd = cmd.trim();
    if cmd.is_empty() {
        return (String::new(), Vec::new());
    }
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut escaped = false;
    for ch in cmd.chars() {
        if escaped {
            cur.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_quotes => {
                cur.push(ch);
                escaped = true;
            }
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !cur.is_empty() {
                    parts.push(cur.clone());
                    cur.clear();
                }
            }
            _ => cur.push(ch),
        }
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    let program = parts.first().cloned().unwrap_or_default();
    (program, parts.into_iter().skip(1).collect())
}

/// 把 npm 之类解析成实际可执行文件（绕过 .ps1/.cmd 的 shell 包装）
fn resolve_program(program: &str) -> Option<PathBuf> {
    // 已带扩展名或绝对路径，直接用
    let p = PathBuf::from(program);
    if p.is_absolute() && p.is_file() {
        return Some(p);
    }
    let exts = ["exe", "cmd", "bat"];
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        // 1) 精确文件名（含扩展名）
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
        // 2) 补扩展名
        for ext in exts {
            let candidate = dir.join(format!("{}.{}", program, ext));
            if candidate.is_file() {
                // .cmd/.bat 需要 cmd /c 调起，直接返回路径，由调用方判断
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
pub fn run_in_env(
    app: AppHandle,
    registry: State<RunRegistry>,
    run_id: u32,
    command: String,
    env_file: Option<String>,
    working_dir: Option<String>,
) -> Result<(), String> {
    let (program, args) = split_command_line(&command);
    if program.is_empty() {
        return Err("命令不能为空".into());
    }

    // Windows 上 .ps1/.cmd/.bat 不能直接 CreateProcess，走 cmd /c
    let lower = program.to_lowercase();
    let (actual_program, prefix_args): (String, Vec<String>) =
        if lower.ends_with(".ps1") {
            (
                "powershell".to_string(),
                vec!["-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into()],
            )
        } else if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            ("cmd".to_string(), vec!["/c".into()])
        } else {
            (program.clone(), Vec::new())
        };

    let resolved = resolve_program(&actual_program).ok_or_else(|| format!("找不到命令: {}", program))?;

    // 组装最终 argv
    let mut final_argv: Vec<String> = prefix_args;
    final_argv.push(resolved.to_string_lossy().into_owned());
    final_argv.extend(args);

    // 构造环境：系统环境 + .env（.env 优先）
    let mut env_map: std::collections::HashMap<String, String> = std::env::vars().collect();
    if let Some(path) = &env_file {
        let file = crate::dotenv_io::parse_env_file(path)?;
        for e in &file.entries {
            if !e.key.is_empty() {
                env_map.insert(e.key.clone(), e.value.clone());
            }
        }
    }

    // 工作目录：默认用 .env 所在目录，其次当前目录
    let workdir: PathBuf = working_dir
        .map(PathBuf::from)
        .or_else(|| {
            env_file
                .as_ref()
                .and_then(|p| PathBuf::from(p).parent().map(|d| d.to_path_buf()))
        })
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let child = Command::new(&final_argv[0])
        .args(&final_argv[1..])
        .current_dir(&workdir)
        .env_clear()
        .envs(&env_map)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动失败: {}", e))?;

    let child = Arc::new(Mutex::new(child));
    let run_id_u = run_id;
    registry
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(run_id_u, RunningChild { child: child.clone() });

    // stdout 线程
    {
        let mut c = child.lock().unwrap();
        let stdout = c.stdout.take().ok_or("无法捕获 stdout")?;
        let app2 = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app2.emit(
                            "run-output",
                            RunOutput { run_id: run_id_u, line: l, stream: "out".into() },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }
    // stderr 线程
    {
        let mut c = child.lock().unwrap();
        let stderr = c.stderr.take().ok_or("无法捕获 stderr")?;
        let app2 = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app2.emit(
                            "run-output",
                            RunOutput { run_id: run_id_u, line: l, stream: "err".into() },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // 等待退出线程
    {
        let child2 = child.clone();
        let app2 = app.clone();
        let reg = registry.0.clone();
        let cmdline = command.clone();
        thread::spawn(move || {
            let code = {
                let mut c = child2.lock().unwrap();
                c.wait().ok().and_then(|s| s.code())
            };
            let killed = {
                let mut r = reg.lock().unwrap_or_else(|e| e.into_inner());
                let killed = r.get(&run_id_u).map(|_| false).unwrap_or(true);
                r.remove(&run_id_u);
                killed
            };
            let _ = app2.emit(
                "run-exit",
                RunExit { run_id: run_id_u, code, killed },
            );
            let _ = cmdline;
        });
    }

    Ok(())
}

#[tauri::command]
pub fn stop_run(registry: State<RunRegistry>, run_id: u32) -> Result<(), String> {
    let child_arc = {
        let mut reg = registry.0.lock().unwrap_or_else(|e| e.into_inner());
        reg.remove(&run_id).map(|c| c.child)
    };
    match child_arc {
        Some(child) => {
            let mut c = child.lock().unwrap();
            // 先 kill 子进程树（taskkill /T /F 更可靠）
            let pid = c.id();
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .output();
            let _ = c.kill();
            Ok(())
        }
        None => Err(format!("运行 #{} 不存在或已退出", run_id)),
    }
}

/// 获取常用的运行预设（npm/go 等检测）
#[tauri::command]
pub fn detect_toolchains() -> Vec<crate::types::Toolchain> {
    let mut out = Vec::new();
    let probes: [(&str, &str); 6] = [
        ("node", "node --version"),
        ("npm", "npm --version"),
        ("pnpm", "pnpm --version"),
        ("go", "go version"),
        ("python", "python --version"),
        ("cargo", "cargo --version"),
    ];
    for (name, _) in &probes {
        let found = resolve_program(name).is_some();
        out.push(crate::types::Toolchain {
            name: name.to_string(),
            available: found,
        });
    }
    out
}
