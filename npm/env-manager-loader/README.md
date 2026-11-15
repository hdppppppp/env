# env-manager-loader

让 Node 程序启动时自动加载 env-manager 管理的 `.env`，并附带 CLI 给**任意程序**（npm / go / python…）注入这套环境变量。

## 安装

```bash
npm i -g ./npm/env-manager-loader     # 全局装，得到 envmanager 命令
# 或项目内
npm i ./npm/env-manager-loader
```

## 用法一：Node 程序自动加载（最常用）

```bash
# 启动时自动加载 ./.env（或环境变量 ENV_MANAGER_FILE 指定的文件）
node -r env-manager-loader app.js

# 或写入 package.json
{
  "scripts": {
    "start": "node -r env-manager-loader app.js"
  }
}

# 设 ENV_MANAGER_AUTOLOAD=0 可禁用自动加载
```

或在代码里显式加载：

```js
// CommonJS
require('env-manager-loader').load();            // 加载 ./.env，不覆盖已有变量
require('env-manager-loader').load({ override: true, path: './config/.env' });

// ESM
import { load } from 'env-manager-loader';
load({ override: true });
```

- 已存在的环境变量默认不覆盖（与 dotenv 行为一致），`override: true` 时 .env 优先
- 找不到 .env 时静默跳过（自动加载模式下），显式 `load()` 会抛错

## 用法二：envmanager CLI 按项目启动任意程序

```bash
envmanager run -- npm run dev                        # 当前项目（./.env）
envmanager run --dir D:\proj-a -- go run .           # 指定项目目录，取 D:\proj-a\.env
envmanager run --mode production -- node app.js      # 叠加 .env.production / .env.production.local
envmanager run --env D:\proj\.env -- python x.py     # 显式指定文件
envmanager print --dir D:\proj-b --mode production   # 预览将注入的变量（含来源文件）
```

**每个项目一套变量**：`.env` 跟着项目目录走，`--dir` 指哪个项目就加载哪套，互不干扰。

**叠加顺序**（后者覆盖前者）：

```
.env → .env.<mode> → .env.<mode>.local
```

例如 `--mode production` 时 `.env` 里的公共配置先加载，`.env.production` 里的覆盖它；`.local` 文件放个人覆盖项（建议加进 .gitignore）。

规则：系统环境 + .env 合并注入子进程，同名时 .env 优先（`--override` 控制）；只影响本次启动的进程。

## 与 GUI 的关系

- GUI（env-manager.exe）负责编辑 .env 与系统变量
- 本包负责「让程序用上这些变量」
- 约定：CLI 与 `node -r` 都会找 `./.env`，或设 `ENV_MANAGER_FILE` 指向 GUI 里正在编辑的文件
