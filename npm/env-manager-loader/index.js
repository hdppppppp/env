'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** 解析 .env 文本：支持注释、export 前缀、引号值、行尾注释 */
function parseEnvText(text) {
  const out = {};
  for (let raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let body = line;
    if (body.startsWith('export ')) body = body.slice(7).trim();
    const eq = body.indexOf('=');
    if (eq < 0) continue;
    const key = body.slice(0, eq).trim();
    if (!key) continue;
    let value = body.slice(eq + 1).trim();
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const h = value.indexOf(' #');
      if (h >= 0) value = value.slice(0, h).trim();
    }
    if (value.length >= 2) {
      const a = value[0];
      const b = value[value.length - 1];
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}

/** 定位 env-manager.exe（加密配置库的宿主） */
function findExe() {
  // 1) 显式环境变量
  if (process.env.ENV_MANAGER_EXE && fs.existsSync(process.env.ENV_MANAGER_EXE)) {
    return process.env.ENV_MANAGER_EXE;
  }
  // 2) 常见安装位置
  const candidates = [
    'F:\\env-backup\\env-manager\\env-manager.exe',
    path.join(process.env.APPDATA || '', 'env-manager', 'env-manager.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'env-manager', 'env-manager.exe'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 从加密配置库读取项目环境（调用 env-manager.exe vault-print，本机密钥解密）
 * @param {string} project 项目名
 * @returns {Object<string,string>}
 */
function loadFromVault(project) {
  const exe = findExe();
  if (!exe) {
    throw new Error(
      '找不到 env-manager.exe（加密配置库宿主）。设 ENV_MANAGER_EXE 指向它，或确认默认安装位置。',
    );
  }
  const out = execFileSync(exe, ['vault-print', String(project)], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  return parseEnvText(out);
}

/**
 * 解析加载来源：
 *  - project 模式（opts.project 或 .envref 文件）→ 加密配置库
 *  - 文件模式（opts.path / ENV_MANAGER_FILE / <dir>/.env）→ 明文 .env
 */
function resolveSources(opts) {
  const dir = opts.dir || process.cwd();
  const sources = []; // [{ kind: 'vault', project } | { kind: 'file', file }]

  // 1) 显式 project
  if (opts.project) {
    sources.push({ kind: 'vault', project: opts.project });
    return { dir, sources };
  }

  // 2) 项目目录里的 .envref（内容即项目名，或以 @project 开头的注释形式）
  const refFile = path.resolve(dir, '.envref');
  if (fs.existsSync(refFile)) {
    const content = fs.readFileSync(refFile, 'utf8').trim();
    const name =
      content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#')) || '';
    if (name) {
      sources.push({ kind: 'vault', project: name });
      return { dir, sources };
    }
  }

  // 3) 文件模式：.env + 模式叠加
  const candidates = [opts.path || '.env'];
  for (const m of opts.modes || []) {
    candidates.push(`.env.${m}`, `.env.${m}.local`);
  }
  for (const c of candidates) {
    sources.push({ kind: 'file', file: path.isAbsolute(c) ? c : path.resolve(dir, c) });
  }
  return { dir, sources };
}

/**
 * 加载环境变量并注入 process.env
 * @param {object} [opts]
 * @param {string}   [opts.project]  加密配置库项目名（优先于一切）
 * @param {string}   [opts.path]     .env 文件路径
 * @param {string}   [opts.dir]      项目目录（默认 process.cwd()）
 * @param {string[]} [opts.modes]    模式叠加 ['.env.<mode>', '.env.<mode>.local']
 * @param {boolean}  [opts.override] 覆盖已有变量（默认 false）
 * @returns {{files: string[], projects: string[], parsed: object, applied: object}}
 */
function load(opts = {}) {
  const override = opts.override === true;
  const { dir, sources } = resolveSources(opts);

  const files = [];
  const projects = [];
  const parsed = {};
  let anySource = false;

  for (const s of sources) {
    if (s.kind === 'vault') {
      const obj = loadFromVault(s.project);
      Object.assign(parsed, obj);
      projects.push(s.project);
      anySource = true;
    } else {
      if (fs.existsSync(s.file)) {
        Object.assign(parsed, parseEnvText(fs.readFileSync(s.file, 'utf8')));
        files.push(s.file);
        anySource = true;
      }
    }
  }

  if (!anySource) {
    // 兼容旧错误语义：文件模式找不到时抛错
    throw new Error(`找不到环境来源：${sources.map((s) => s.file || s.project).join(', ')}`);
  }

  const applied = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (override || process.env[k] === undefined) {
      process.env[k] = v;
      applied[k] = v;
    }
  }
  return { files, projects, parsed, applied };
}

/** 兼容旧 API：返回第一个显式文件路径或默认路径 */
function resolveFile(opts) {
  const p =
    (opts && opts.path) ||
    process.env.ENV_MANAGER_FILE ||
    path.resolve(process.cwd(), '.env');
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

module.exports = { parseEnvText, resolveFile, resolveSources, load, loadFromVault, findExe };

// 被 `node -r env-manager-loader` 引入时自动加载：
// 项目目录有 .envref → 加密配置库；否则加载 ./.env。
// ENV_MANAGER_AUTOLOAD=0 禁用；找不到任何来源时静默跳过。
if (process.env.ENV_MANAGER_AUTOLOAD !== '0' && !process.env.ENV_MANAGER_SKIP_AUTOLOAD) {
  try {
    load();
  } catch (_) {
    /* 无来源时静默 */
  }
}
