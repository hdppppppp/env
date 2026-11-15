# Env Manager — 环境变量管理器

Rust (Tauri 2) 后端 + React 19 GUI 的桌面环境变量管理工具：
**GUI 编辑 · 加密配置库 · 按项目引用 · 一键注入启动 · 换机器迁移**。

## 让程序用上环境变量（npm 包 env-manager-loader）

```bash
# 方式一：从 GitHub 直接安装（无需 npm 账号）
npm i -g github:hdppppppp/env#pkg

# 方式二：本地目录安装
npm i -g ./npm/env-manager-loader
```

包源码在 `pkg` 分支（由 `scripts/sync-pkg.ps1` 从主分支同步）；改了包代码后重新运行该脚本即可。

**Node 程序**——启动即自动加载（放在 package.json scripts 里）：

```json
{ "scripts": { "start": "node -r env-manager-loader app.js" } }
```

**任意程序**（npm / go / python / 任意 exe）——envmanager 注入后启动：

```bash
envmanager run -- npm run dev            # 当前项目（./.env）
envmanager run --dir D:\proj-a -- go run .          # 指定项目目录
envmanager run --mode production -- node app.js     # 叠加 .env.production
envmanager run --project demo -- python main.py     # 从加密配置库读取
envmanager print --project demo                     # 预览将注入的变量（含来源）
```

环境来源优先级：`--project`（加密库） > `<dir>/.envref`（引用文件，内容为项目名） > 明文 `.env`。
规则：系统环境 + .env 合并注入子进程，同名时 .env 优先（`--override` 控制）；只影响本次启动的进程。
详见 [npm/env-manager-loader/README.md](npm/env-manager-loader/README.md)。

## 功能

### 文件 .env 标签页
- 打开 / 新建 / 保存（Ctrl+S）/ 另存为 `.env` 文件，**保留注释与顺序**
- 密文自动识别：key 含 `PASSWORD / SECRET / TOKEN / KEY / CREDENTIAL / PRIVATE` 时值默认打码
- 全文筛选、行内编辑、增删行
- JSON 导入导出（`[{key,value,comment}]` 与 `{"KEY":"VALUE"}` 两种格式）
- 在资源管理器中定位；拖拽打开；最近文件（10 条）

### 系统环境变量标签页
- 读写注册表 `HKCU\Environment`（仅当前用户，无需管理员）
- 值含 `%` 自动写 `REG_EXPAND_SZ`；「广播环境变更」使新进程立即生效

### 运行标签页
- 把当前 .env 注入任意命令启动（npm / go / python / exe），实时输出、可终止
- 工具链探测（node/npm/pnpm/go/python/cargo 可用性一目了然）

### 配置库标签页（加密存储）
- **AES-256-GCM** 加密整个配置库，存于 `%APPDATA%\env-manager\vault.envstore`
- 密钥首次自动生成（OS 安全随机），仅存本机 `vault.key`，磁盘上无明文
- 项目环境集中管理：开发项目里不放 `.env`，放一行项目名的 `.envref` 即可引用
- 「导出迁移包 / 导入迁移包」：PBKDF2(20万次) + AES-GCM 密码加密，换机器/备份两用

## 换机器迁移

```
旧机器：配置库 → 📦 导出迁移包 → 设密码 → env-vault-backup.emvault
新机器：装好 Env Manager → 配置库 → 📥 导入迁移包 → 输同一密码
```

新机器自动重新生成本机密钥；各项目 `.envref` 不用改。密码遗忘无法恢复（无后门）。

## 开发

```powershell
cd env-manager
pnpm install          # 前端依赖
pnpm tauri dev        # 开发模式（带热重载）
```

## 构建

```powershell
cd env-manager
pnpm build            # 仅前端 (tsc + vite)
cd src-tauri
cargo build --release --features custom-protocol   # 后端（custom-protocol 内嵌前端资源）
# 产物: src-tauri/target/release/env-manager.exe（需同目录 WebView2Loader.dll）
```

## 技术栈

| 层 | 技术 |
|---|---|
| GUI | React 19 + TypeScript + Vite 7 |
| 后端 | Rust 2021 + Tauri 2 |
| .env 解析 | 自研（保留注释/顺序，支持 export 前缀、引号值、行尾注释） |
| 系统变量 | `reg.exe` 读写 HKCU\Environment |
| 加密库 | aes-gcm + pbkdf2 + sha2（密钥本机生成） |
| 工具链 | windows-gnu（mingw-w64，见 `src-tauri/rust-toolchain.toml`） |

## 目录结构

```
env-manager/
├── env-manager.exe + WebView2Loader.dll   # ★ 成品，双击即用（不入库，见 .gitignore）
├── npm/env-manager-loader/                # ★ npm 包：node -r 自动加载 + envmanager CLI
│   ├── index.js                           #   loader（.env / .envref / 加密库三种来源）
│   └── cli.js                             #   envmanager run / print
├── src/                                   # React GUI
│   ├── App.tsx                            # 主界面（文件 / 系统变量 / 运行 / 配置库）
│   ├── RunTab.tsx                         # 运行页
│   ├── VaultTab.tsx                       # 配置库页（加密存取 / 迁移包）
│   ├── api.ts                             # Tauri invoke 封装
│   └── styles.css
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                         # Tauri 命令入口
│   │   ├── dotenv_io.rs                   # .env 解析 / 写回
│   │   ├── json_io.rs                     # JSON 导入导出
│   │   ├── system_env.rs                  # HKCU\Environment 注册表读写
│   │   ├── runner.rs                      # .env 环境中运行命令
│   │   ├── vault.rs                       # AES-256-GCM 加密配置库 + 迁移包
│   │   └── recent.rs                      # 最近文件
│   ├── tauri.conf.json
│   └── rust-toolchain.toml
├── 介绍.md                                # 项目介绍
└── README.md
```

## 安全说明

- 加密配置库：AES-256-GCM，密钥不出本机；迁移包需密码，遗忘不可恢复
- 系统 .env 文件仍是明文存储（dotenv 生态惯例），密钥类变量在 GUI 中默认遮罩
- 系统变量修改立即写注册表，删除前有确认弹窗
- 注入子进程的变量只存在于该进程生命周期，不污染系统
