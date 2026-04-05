# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Quick Quick Run GUI 是一个 Tauri v2 桌面应用，用于将 Web 应用包装为原生窗口。用户输入 shell 命令（如启动 dev server）和 URL，应用执行命令、等待 URL 可达后加载到 WebView 中显示。界面文本为中文。

## 技术栈

- **前端：** Vue 3（Composition API + `<script setup>`）、TypeScript、Vite
- **后端：** Rust、Tauri v2、tokio（异步）、serde
- **包管理器：** Bun

## 常用命令

```bash
bun run dev          # 仅启动 Vite 开发服务器（前端）
bun run build        # 类型检查（vue-tsc）+ Vite 构建
bun run tauri:dev    # Tauri 完整开发模式（Rust + 前端）
bun run tauri:build  # Tauri 生产构建
bun run preview      # 预览 Vite 生产构建
```

当前未配置测试运行器和代码检查工具。

## 架构

### IPC 命令

Vue 前端通过 `@tauri-apps/api/core` 的 `invoke()` 与 Rust 后端通信：

| 命令 | 功能 |
|---|---|
| `launch_command` | 在新进程组中启动 shell 进程（Unix: `sh -c`，Windows: `cmd /C`） |
| `kill_process` | 终止进程组（Unix: SIGTERM → SIGKILL） |
| `navigate_to_url` | 在 WebView 中加载目标 URL |
| `navigate_to_settings` | 返回设置页面 |
| `check_url_reachable` | 轮询 TCP 连接，检测服务器是否就绪 |
| `resize_window` | 调整窗口大小 |

### 数据流

1. 用户在设置页面（`App.vue`）输入命令和 URL
2. `launch_command` 以独立进程组启动 shell 命令
3. `check_url_reachable` 轮询 URL 直到 TCP 连接成功
4. `navigate_to_url` 在 WebView 中加载运行中的服务
5. 停止时，`kill_process` 终止整个进程树

### 关键文件

- `src/App.vue` — 单文件 Vue 组件：设置表单 + WebView 导航逻辑
- `src-tauri/src/lib.rs` — 所有 Tauri 命令和进程生命周期管理
- `src-tauri/tauri.conf.json` — 窗口配置、CSP、权限
- `src-tauri/capabilities可以/` — Tauri 权限定义

### 跨平台说明

进程管理使用条件编译（`#[cfg(unix)]` / `#[cfg(windows)]`）。Unix 使用进程组（`setpgid`、`kill(-pgid)`）；Windows 使用 `CREATE_NEW_PROCESS_GROUP` 和 `taskkill`。
