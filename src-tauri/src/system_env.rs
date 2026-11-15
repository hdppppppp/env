//! 用户级系统环境变量（HKCU\Environment，通过 reg.exe 读写）
use std::collections::BTreeMap;
use std::os::windows::process::CommandExt;
use std::process::Command;

use crate::types::SystemEntry;

const ENV_KEY: &str = "HKCU\\Environment";

pub fn user_env_dir() -> Option<String> {
    Some(ENV_KEY.to_string())
}

fn run_reg(args: &[&str]) -> Result<String, String> {
    let out = Command::new("reg")
        .args(args)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("执行 reg 失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        return Err(format!("reg 失败: {}{}", stdout, stderr));
    }
    Ok(stdout)
}

pub fn list_user_env() -> Vec<SystemEntry> {
    let mut map: BTreeMap<String, String> = BTreeMap::new();
    if let Ok(out) = run_reg(&["query", ENV_KEY]) {
        for line in out.lines() {
            let line = line.trim_end();
            // 形如: "    NAME    REG_SZ    value" 或 REG_EXPAND_SZ（可能有四段）
            if !line.trim().starts_with("HKEY") && line.contains("REG_") {
                let mut parts = line.splitn(3, "    ");
                let _ = parts.next();
                let name = match parts.next() {
                    Some(n) => n.trim().to_string(),
                    None => continue,
                };
                if name.is_empty() {
                    continue;
                }
                let rest = match parts.next() {
                    Some(r) => r.trim().to_string(),
                    None => continue,
                };
                let value = match rest.split_once("    ") {
                    Some((_typ, v)) => v.trim().to_string(),
                    None => String::new(),
                };
                map.insert(name, value);
            }
        }
    }
    map.into_iter()
        .map(|(name, value)| SystemEntry { name, value })
        .collect()
}

pub fn set_user_env(name: &str, value: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("变量名不能为空".into());
    }
    if value.contains('%') {
        // REG_EXPAND_SZ，可支持 %VAR% 引用
        run_reg(&["add", ENV_KEY, "/v", name, "/t", "REG_EXPAND_SZ", "/d", value, "/f"])
    } else {
        run_reg(&["add", ENV_KEY, "/v", name, "/t", "REG_SZ", "/d", value, "/f"])
    }
    .map(|_| ())
}

pub fn delete_user_env(name: &str) -> Result<(), String> {
    run_reg(&["delete", ENV_KEY, "/v", name, "/f"]).map(|_| ())
}

/// 广播 WM_SETTINGCHANGE，让新开的进程读到新环境（不修改已运行进程）
pub fn broadcast_env_change() -> Result<(), String> {
    run_reg(&["add", ENV_KEY, "/v", "__dummy__", "/t", "REG_SZ", "/d", "1", "/f"])?;
    run_reg(&["delete", ENV_KEY, "/v", "__dummy__", "/f"])?;
    Ok(())
}
