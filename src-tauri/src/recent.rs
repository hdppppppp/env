use std::fs;
use std::path::PathBuf;

/// 最近打开的文件列表，存于 %APPDATA%/env-manager/recent.json
fn recent_file() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join("AppData\\Roaming"));
    base.join("env-manager").join("recent.json")
}

pub fn load_recent() -> Vec<String> {
    let p = recent_file();
    if let Ok(text) = fs::read_to_string(&p) {
        if let Ok(v) = serde_json::from_str::<Vec<String>>(&text) {
            return v;
        }
    }
    Vec::new()
}

pub fn save_recent(list: &[String]) {
    let p = recent_file();
    if let Some(dir) = p.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(list) {
        let _ = fs::write(&p, json);
    }
}

pub fn add_recent(path: &str) -> Vec<String> {
    let mut list = load_recent();
    list.retain(|p| p != path);
    list.insert(0, path.to_string());
    list.truncate(10);
    save_recent(&list);
    list
}

pub fn clear_recent() -> Vec<String> {
    save_recent(&[]);
    Vec::new()
}
