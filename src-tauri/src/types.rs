use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
    pub comment: Option<String>,
}

/// 一个 .env 文件的完整表示
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvFile {
    /// 文件绝对路径
    pub path: String,
    /// 文件最上面的整段注释（保留原样）
    pub header: String,
    pub entries: Vec<EnvEntry>,
    /// 文件编码信息
    pub encoding: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemEntry {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Toolchain {
    pub name: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub current_path: Option<String>,
    pub recent: Vec<String>,
    /// HKCU\Environment 注册表目录，供界面展示
    pub system_dir: String,
}
