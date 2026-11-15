//! 加密配置库（vault）：环境变量以 AES-256-GCM 加密存储在应用数据目录。
//! 密钥文件首次自动生成（32 字节随机），存于 %APPDATA%\env-manager\vault.key。
//! 存储条目格式: <name>.vault = base64(nonce(12) || ciphertext)，
//! 文件头 magic "EMV1" 用于识别库文件。
use std::fs;
use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::types::EnvEntry;

const MAGIC: &[u8; 4] = b"EMV1";

#[derive(Serialize, Deserialize, Debug, Default)]
struct VaultData {
    /// 项目名 -> 条目列表
    projects: std::collections::BTreeMap<String, Vec<EnvEntry>>,
}

fn vault_dir() -> Result<PathBuf, String> {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join("AppData\\Roaming"));
    let dir = base.join("env-manager");
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(dir)
}

fn vault_file() -> Result<PathBuf, String> {
    Ok(vault_dir()?.join("vault.envstore"))
}

fn key_file() -> Result<PathBuf, String> {
    Ok(vault_dir()?.join("vault.key"))
}

/// 读取或首次生成 256 位密钥
fn load_key() -> Result<[u8; 32], String> {
    let kf = key_file()?;
    if kf.is_file() {
        let bytes = fs::read(&kf).map_err(|e| format!("读取密钥失败: {}", e))?;
        if bytes.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            return Ok(k);
        }
        return Err("密钥文件损坏（长度不为 32 字节）".into());
    }
    // 首次生成
    let mut k = [0u8; 32];
    getrandom_fill(&mut k)?;
    fs::write(&kf, &k).map_err(|e| format!("保存密钥失败: {}", e))?;
    Ok(k)
}

fn getrandom_fill(buf: &mut [u8]) -> Result<(), String> {
    // 使用 rand_core::OsRng（操作系统级安全随机，aes-gcm 依赖树内含）
    use rand_core::{OsRng, RngCore};
    OsRng.fill_bytes(buf);
    Ok(())
}

fn encrypt(master: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(master);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; 12];
    getrandom_fill(&mut nonce_bytes)?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, Payload { msg: plain, aad: MAGIC })
        .map_err(|_| "加密失败".to_string())?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt(master: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < 13 {
        return Err("密文损坏".into());
    }
    let (nonce_bytes, ct) = blob.split_at(12);
    let cipher = Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(master));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), Payload { msg: ct, aad: MAGIC })
        .map_err(|_| "解密失败（密钥不匹配或数据损坏）".to_string())
}

/// 读取整个库（解密），不存在则返回空库
fn read_vault(master: &[u8; 32]) -> Result<VaultData, String> {
    let vf = vault_file()?;
    if !vf.is_file() {
        return Ok(VaultData::default());
    }
    let raw = fs::read(&vf).map_err(|e| format!("读取库失败: {}", e))?;
    if raw.len() < 4 || &raw[..4] != MAGIC {
        return Err("库文件格式不正确".into());
    }
    let plain = decrypt(master, &raw[4..])?;
    serde_json::from_slice(&plain).map_err(|e| format!("库内容损坏: {}", e))
}

fn write_vault(master: &[u8; 32], data: &VaultData) -> Result<(), String> {
    let plain = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    let blob = encrypt(master, &plain)?;
    let mut out = Vec::with_capacity(4 + blob.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&blob);
    fs::write(vault_file()?, out).map_err(|e| format!("写入库失败: {}", e))
}

fn valid_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("项目名只能包含字母数字、- _ .，且不超过 64 字符".into());
    }
    Ok(())
}

/* ============ 对外命令 ============ */

#[tauri::command]
pub fn list_projects() -> Result<Vec<String>, String> {
    let master = load_key()?;
    let v = read_vault(&master)?;
    Ok(v.projects.keys().cloned().collect())
}

/// 保存项目环境（entries 序列化后加密）
#[tauri::command]
pub fn save_project(name: String, entries: Vec<EnvEntry>) -> Result<(), String> {
    save_project_inner(&name, &entries)
}

fn save_project_inner(name: &str, entries: &[EnvEntry]) -> Result<(), String> {
    valid_name(name)?;
    let master = load_key()?;
    let mut v = read_vault(&master)?;
    v.projects.insert(name.to_string(), entries.to_vec());
    write_vault(&master, &v)
}

#[tauri::command]
pub fn load_project(name: String) -> Result<Vec<EnvEntry>, String> {
    load_project_inner(&name)
}

fn load_project_inner(name: &str) -> Result<Vec<EnvEntry>, String> {
    valid_name(name)?;
    let master = load_key()?;
    let v = read_vault(&master)?;
    v.projects
        .get(name)
        .cloned()
        .ok_or_else(|| format!("配置库中不存在项目 \"{}\"", name))
}

#[tauri::command]
pub fn delete_project(name: String) -> Result<(), String> {
    delete_project_inner(&name)
}

fn delete_project_inner(name: &str) -> Result<(), String> {
    valid_name(name)?;
    let master = load_key()?;
    let mut v = read_vault(&master)?;
    if v.projects.remove(name).is_none() {
        return Err(format!("配置库中不存在项目 \"{}\"", name));
    }
    write_vault(&master, &v)
}

/// 导出某项目为明文 .env 文件
#[tauri::command]
pub fn export_project(name: String, dest: String) -> Result<(), String> {
    let entries = load_project_inner(&name)?;
    crate::dotenv_io::write_env_file(&dest, &entries)
}

/// 导入明文 .env 文件到库
#[tauri::command]
pub fn import_project(name: String, src: String) -> Result<(), String> {
    let file = crate::dotenv_io::parse_env_file(&src)?;
    save_project_inner(&name, &file.entries)
}

/// 配置库状态信息（供 GUI 展示；不泄露密钥内容）
#[derive(Serialize, Debug)]
pub struct VaultInfo {
    pub file: String,
    pub key_file: String,
    pub size_bytes: u64,
    pub key_sha256: String,
}

#[tauri::command]
pub fn vault_info() -> Result<VaultInfo, String> {
    let vf = vault_file()?;
    let kf = key_file()?;
    Ok(VaultInfo {
        file: vf.to_string_lossy().into_owned(),
        key_file: kf.to_string_lossy().into_owned(),
        size_bytes: fs::metadata(&vf).map(|m| m.len()).unwrap_or(0),
        key_sha256: {
            let k = load_key()?;
            let mut h = Sha256::new();
            h.update(k);
            hex(&h.finalize())
        },
    })
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

/* ============ 迁移（换机器）：密码加密导出 / 导入 ============ */

/// PBKDF2-HMAC-SHA256 派生密钥
fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    use hmac::Hmac;
    type HmacSha256 = Hmac<Sha256>;
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2::<HmacSha256>(password.as_bytes(), salt, 200_000, &mut out)
        .map_err(|_| "派生密钥失败".to_string())?;
    Ok(out)
}

/// 迁移包格式:
/// "EMIG1" || salt(16) || nonce(12) || AES-256-GCM( 密码校验标签 || vault_plain )
/// 密码校验标签 = "ok" 的 GCM 加密是否成功即校验（解密时先解出 2 字节 "ok" 验证密码）
#[derive(Serialize, Deserialize, Debug, Default)]
struct MigrationPack {
    projects: std::collections::BTreeMap<String, Vec<EnvEntry>>,
}

fn migration_cipher(pack: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    getrandom_fill(&mut salt)?;
    let key = derive_key(password, &salt)?;
    let mut nonce_bytes = [0u8; 12];
    getrandom_fill(&mut nonce_bytes)?;

    let cipher = Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(&key));
    // 明文 = b"ok" || vault 序列化；"ok" 兼作密码校验
    let mut plain = Vec::with_capacity(2 + pack.len());
    plain.extend_from_slice(b"ok");
    plain.extend_from_slice(pack);

    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain.as_slice())
        .map_err(|_| "加密失败".to_string())?;

    let mut out = Vec::with_capacity(5 + 16 + 12 + ct.len());
    out.extend_from_slice(b"EMIG1");
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn migration_decipher(blob: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if blob.len() < 5 + 16 + 12 + 3 {
        return Err("迁移包损坏或为空".into());
    }
    if &blob[..5] != b"EMIG1" {
        return Err("不是有效的 Env Manager 迁移包".into());
    }
    let salt = &blob[5..21];
    let nonce_bytes = &blob[21..33];
    let ct = &blob[33..];
    let key = derive_key(password, salt)?;
    let cipher = Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(&key));
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|_| "密码错误或迁移包损坏".to_string())?;
    if plain.len() < 2 || &plain[..2] != b"ok" {
        return Err("密码错误".into());
    }
    Ok(plain[2..].to_vec())
}

/// 用密码把整个库加密导出到文件（换机器 / 备份）
#[tauri::command]
pub fn vault_export(dest: String, password: String) -> Result<usize, String> {
    if password.len() < 6 {
        return Err("密码至少 6 位".into());
    }
    let master = load_key()?;
    let v = read_vault(&master)?;
    let n = v.projects.len();
    let pack = serde_json::to_vec(&MigrationPack { projects: v.projects }).map_err(|e| e.to_string())?;
    let blob = migration_cipher(&pack, &password)?;
    fs::write(&dest, blob).map_err(|e| format!("写入失败: {}", e))?;
    Ok(n)
}

/// 用密码从迁移包导入（合并进本机库；同名项目以包内为准）
#[tauri::command]
pub fn vault_import(src: String, password: String) -> Result<usize, String> {
    let blob = fs::read(&src).map_err(|e| format!("读取失败: {}", e))?;
    let plain = migration_decipher(&blob, &password)?;
    let pack: MigrationPack = serde_json::from_slice(&plain).map_err(|e| format!("迁移包内容损坏: {}", e))?;
    let master = load_key()?;
    let mut v = read_vault(&master)?;
    let mut n = 0;
    for (name, entries) in pack.projects {
        v.projects.insert(name, entries);
        n += 1;
    }
    write_vault(&master, &v)?;
    Ok(n)
}
