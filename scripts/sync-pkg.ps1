#!/usr/bin/env pwsh
# 同步 npm 包子目录到 GitHub pkg 分支（npm 从 github:hdppppppp/env#pkg 安装的就是它）
# 用法: .\scripts\sync-pkg.ps1  （在 env-manager 目录下运行）
$ErrorActionPreference = 'Stop'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY = 'http://127.0.0.1:7897'

git subtree push --prefix npm/env-manager-loader origin pkg
Write-Host "pkg 分支已更新。安装: npm i github:hdppppppp/env#pkg"
