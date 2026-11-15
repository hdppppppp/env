mod dotenv_io;
mod json_io;
mod system_env;
mod types;
mod recent;
mod runner;
pub mod vault;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub current_path: Mutex<Option<String>>,
}

#[tauri::command]
fn get_state(state: tauri::State<AppState>) -> types::AppState {
    let recent = recent::load_recent();
    types::AppState {
        current_path: state
            .current_path
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
        recent,
        system_dir: system_env::user_env_dir().unwrap_or_default(),
    }
}

#[tauri::command]
fn set_current_path(state: tauri::State<AppState>, path: Option<String>) {
    *state
        .current_path
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = path;
}

#[tauri::command]
fn add_recent_file(path: String) -> Vec<String> {
    recent::add_recent(&path)
}

#[tauri::command]
fn clear_recent_files() -> Vec<String> {
    recent::clear_recent()
}

#[tauri::command]
fn load_env_file(path: String) -> Result<types::EnvFile, String> {
    let file = dotenv_io::parse_env_file(&path)?;
    Ok(file)
}

#[tauri::command]
fn save_env_file(path: String, entries: Vec<types::EnvEntry>) -> Result<types::EnvFile, String> {
    dotenv_io::write_env_file(&path, &entries)?;
    let file = dotenv_io::parse_env_file(&path)?;
    Ok(file)
}

#[tauri::command]
fn import_json(path: String) -> Result<Vec<types::EnvEntry>, String> {
    json_io::import_json_file(&path)
}

#[tauri::command]
fn export_json(path: String, entries: Vec<types::EnvEntry>) -> Result<String, String> {
    json_io::export_json_file(&path, &entries)
}

#[tauri::command]
fn list_system_env() -> Vec<types::SystemEntry> {
    system_env::list_user_env()
}

#[tauri::command]
fn set_system_env(name: String, value: String) -> Result<(), String> {
    system_env::set_user_env(&name, &value)
}

#[tauri::command]
fn delete_system_env(name: String) -> Result<(), String> {
    system_env::delete_user_env(&name)
}

#[tauri::command]
fn refresh_env_broadcast() -> Result<(), String> {
    system_env::broadcast_env_change()
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_file() {
        // 打开资源管理器并选中该文件
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    } else if p.is_dir() {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("路径不存在: {}", path))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 未传入参数时默认定位到用户目录
            let start = std::env::args()
                .nth(1)
                .unwrap_or_else(|| {
                    dirs::home_dir()
                        .unwrap_or_else(|| PathBuf::from("."))
                        .to_string_lossy()
                        .into_owned()
                });
            let path = std::path::Path::new(&start);
            let resolved = if path.is_file() {
                start
            } else {
                // 目录则尝试找 .env
                let candidate = path.join(".env");
                if candidate.is_file() {
                    candidate.to_string_lossy().into_owned()
                } else {
                    dirs::home_dir()
                        .unwrap_or_else(|| PathBuf::from("."))
                        .join(".env")
                        .to_string_lossy()
                        .into_owned()
                }
            };
            let resolved = if std::path::Path::new(&resolved).is_file() {
                Some(resolved)
            } else {
                None
            };
            *app.state::<AppState>().current_path.lock().unwrap() = resolved;
            Ok(())
        })
        .manage(AppState {
            current_path: Mutex::new(None),
        })
        .manage(runner::RunRegistry::new())
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_current_path,
            add_recent_file,
            clear_recent_files,
            load_env_file,
            save_env_file,
            import_json,
            export_json,
            list_system_env,
            set_system_env,
            delete_system_env,
            refresh_env_broadcast,
            reveal_in_explorer,
            runner::run_in_env,
            runner::stop_run,
            runner::detect_toolchains,
            vault::list_projects,
            vault::save_project,
            vault::load_project,
            vault::delete_project,
            vault::export_project,
            vault::import_project,
            vault::vault_info,
            vault::vault_export,
            vault::vault_import
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
