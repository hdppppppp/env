#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { load } = require('./index.js');

function quote(s) {
  return /\s/.test(s) ? '"' + String(s).replace(/"/g, '\\"') + '"' : String(s);
}

function usage() {
  process.stderr.write(
    [
      'envmanager - 按项目加载 .env 并启动任意程序',
      '',
      '用法:',
      '  envmanager run [--dir <项目目录>] [--project <名称>] [--env <file>] [--mode <m>...] [--override] -- <command> [args...]',
      '  envmanager print [--dir <项目目录>] [--project <名称>] [--mode <m>...]',
      '',
      '环境来源（按优先级）:',
      '  1. --project <名称>   从加密配置库读取（env-manager.exe 本机密钥解密）',
      '  2. <dir>/.envref      文件内容为配置库项目名，一行即可让项目引用库',
      '  3. <dir>/.env 等文件  明文 .env；--mode 叠加 .env.<mode> / .env.<mode>.local',
      '',
      '示例:',
      '  envmanager run -- npm run dev                       # 当前项目',
      '  envmanager run --dir D:\\proj-a -- go run .          # 指定项目目录',
      '  envmanager run --mode production -- node app.js     # 叠加生产配置',
      '  envmanager run --env D:\\shared.env -- python x.py   # 显式指定文件',
      '  node -r env-manager-loader app.js                   # node 自动加载 ./.env',
    ].join('\n') + '\n',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const sub = argv.shift();
const opts = { env: null, dir: null, override: false, modes: [], project: null };
let rest = [];
let i = 0;
for (; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--env') opts.env = argv[++i];
  else if (a === '--dir') opts.dir = argv[++i];
  else if (a === '--mode') opts.modes.push(argv[++i]);
  else if (a === '--project') opts.project = argv[++i];
  else if (a === '--override') opts.override = true;
  else if (a === '--') { rest = argv.slice(i + 1); break; }
  else rest.push(a);
}

try {
  if (sub === 'print') {
    const { files, projects, parsed } = load({
      path: opts.env,
      dir: opts.dir,
      modes: opts.modes,
      project: opts.project,
      override: false,
    });
    for (const p of projects) process.stderr.write('# vault: ' + p + '\n');
    for (const f of files) process.stderr.write('# ' + f + '\n');
    for (const [k, v] of Object.entries(parsed)) process.stdout.write(k + '=' + v + '\n');
    process.exit(0);
  }

  if (sub !== 'run' || rest.length === 0) usage();

  const { applied } = load({
    path: opts.env,
    dir: opts.dir,
    modes: opts.modes,
    project: opts.project,
    override: opts.override,
  });

  const env = { ...process.env, ...applied };
  // 工作目录：显式 --dir > .env 所在目录 > 当前目录
  const cwd =
    opts.dir ||
    (opts.env ? require('path').dirname(require('path').resolve(opts.env)) : process.cwd());
  const onExit = (code, sig) => process.exit(code == null ? (sig ? 1 : 0) : code);
  const onError = (e) => {
    console.error('envmanager: 启动失败:', e.message);
    process.exit(1);
  };

  if (process.platform === 'win32') {
    // Windows 上 npm/pnpm 等是 .cmd，必须经 shell 解析
    const child = spawn(rest.map(quote).join(' '), {
      shell: true,
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('exit', onExit);
    child.on('error', onError);
  } else {
    const child = spawn(rest[0], rest.slice(1), { cwd, env, stdio: 'inherit' });
    child.on('exit', onExit);
    child.on('error', onError);
  }
} catch (e) {
  console.error('envmanager:', e.message);
  process.exit(1);
}
