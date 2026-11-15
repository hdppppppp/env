// 与 Rust 端 types.rs 对应的类型
export interface EnvEntry {
  key: string;
  value: string;
  comment: string | null;
}

export interface EnvFile {
  path: string;
  header: string;
  entries: EnvEntry[];
  encoding: string;
  size_bytes: number;
}

export interface SystemEntry {
  name: string;
  value: string;
}

export interface Toolchain {
  name: string;
  available: boolean;
}

export interface VaultInfo {
  file: string;
  key_file: string;
  size_bytes: number;
  key_sha256: string;
}

export interface AppState {
  current_path: string | null;
  recent: string[];
  system_dir: string;
}

import { invoke } from '@tauri-apps/api/core';

export const api = {
  getState: () => invoke<AppState>('get_state'),
  setCurrentPath: (path: string | null) => invoke<void>('set_current_path', { path }),
  addRecent: (path: string) => invoke<string[]>('add_recent_file', { path }),
  clearRecent: () => invoke<string[]>('clear_recent_files'),

  loadEnvFile: (path: string) => invoke<EnvFile>('load_env_file', { path }),
  saveEnvFile: (path: string, entries: EnvEntry[]) =>
    invoke<EnvFile>('save_env_file', { path, entries }),

  importJson: (path: string) => invoke<EnvEntry[]>('import_json', { path }),
  exportJson: (path: string, entries: EnvEntry[]) =>
    invoke<string>('export_json', { path, entries }),

  listSystemEnv: () => invoke<SystemEntry[]>('list_system_env'),
  setSystemEnv: (name: string, value: string) => invoke<void>('set_system_env', { name, value }),
  deleteSystemEnv: (name: string) => invoke<void>('delete_system_env', { name }),
  refreshEnvBroadcast: () => invoke<void>('refresh_env_broadcast'),

  revealInExplorer: (path: string) => invoke<void>('reveal_in_explorer', { path }),

  runInEnv: (runId: number, command: string, envFile: string | null, workingDir: string | null) =>
    invoke<void>('run_in_env', { runId, command, envFile, workingDir }),
  stopRun: (runId: number) => invoke<void>('stop_run', { runId }),
  detectToolchains: () => invoke<Toolchain[]>('detect_toolchains'),

  listProjects: () => invoke<string[]>('list_projects'),
  saveProject: (name: string, entries: EnvEntry[]) => invoke<void>('save_project', { name, entries }),
  loadProject: (name: string) => invoke<EnvEntry[]>('load_project', { name }),
  deleteProject: (name: string) => invoke<void>('delete_project', { name }),
  exportProject: (name: string, dest: string) => invoke<void>('export_project', { name, dest }),
  importProject: (name: string, src: string) => invoke<void>('import_project', { name, src }),
  vaultInfo: () => invoke<VaultInfo>('vault_info'),
  migrateExport: (dest: string, password: string) =>
    invoke<number>('vault_export', { dest, password }),
  migrateImport: (src: string, password: string) =>
    invoke<number>('vault_import', { src, password }),
};
