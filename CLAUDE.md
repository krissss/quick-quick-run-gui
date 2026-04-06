# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Quick Quick Run GUI 是一个 Tauri v2 桌面应用，用于将 Web 应用包装为原生窗口。用户配置应用列表（名称、shell 命令、目标 URL），点击卡片即可启动。支持两种模式：主窗口模式（当前窗口导航）和独立窗口模式（新窗口 + iframe，可同时运行多个应用）。界面文本为中文。

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
| `launch_command` | 主窗口模式：启动 shell 进程（key: `_main`） |
| `kill_process` | 终止主窗口进程 |
| `launch_app_window` | 独立窗口模式：启动进程 + 创建新 WebviewWindow（iframe 页面） |
| `stop_app_window` | 停止指定应用进程并关闭其窗口 |
| `get_running_apps` | 返回当前运行的独立窗口应用 ID 列表 |
| `navigate_to_url` | 在 WebView 中加载目标 URL |
| `navigate_to_settings` | 返回设置页面（同时终止主窗口进程） |
| `check_url_reachable` | 轮询 TCP 连接，检测服务器是否就绪 |
| `resize_window` | 调整窗口大小 |
| `set_dock_icon_from_url` | 从 URL 获取 favicon 并设为 macOS Dock 图标 |
| `reset_dock_icon` | 恢复默认 Dock 图标 |
| `set_window_title_from_url` | 从目标页面 `<title>` 同步窗口标题 |
| `fetch_favicon_data_url` | 获取 favicon 并返回 base64 data URL（卡片图标） |

### 进程管理

`AppState` 使用 `HashMap<String, ProcessInfo>` 管理多个并发进程：
- 主窗口模式使用固定 key `"_main"`，同一时间只能运行一个
- 独立窗口模式使用 app ID 作为 key，支持多个应用同时运行
- 进程关闭时通过 `on_window_event(CloseRequested)` 自动清理
- 主窗口销毁时 `force_kill_all` 清理所有子进程

### 独立窗口模式

每个独立应用窗口加载 `app-window.html`（Vite 多页入口），包含：
- 顶部工具栏（停止按钮 + URL 显示）
- 全高 iframe 加载目标应用 URL
- 窗口关闭时自动杀掉关联进程

### 数据流

1. 用户在首页（`App.vue`）点击应用卡片
2. **独立窗口模式**：`launch_app_window` → 启动进程 → 等待 URL 可达 → 创建新窗口 → 主窗口保持不变
3. **主窗口模式**：`launch_command` → `check_url_reachable` → `resize_window` → `navigate_to_url` → 主窗口导航到应用
4. 停止时终止进程组，独立窗口额外关闭窗口

### 前端 UI

- 使用 shadcn-vue 组件库 + Tailwind CSS v4（深色主题）
- 应用卡片网格布局，每个卡片显示图标/渐变首字母 + 名称 + URL
- 编辑弹窗支持配置：名称、命令、URL、窗口尺寸、独立窗口开关
- 运行中的应用显示绿色圆点指示器（通过 `app-launched`/`app-stopped` 事件更新）

### 关键文件

- `src/App.vue` — 主页面：应用卡片列表 + 导航逻辑
- `src/AppWindow.vue` — 独立窗口页面：工具栏 + iframe
- `src/app-window.ts` — 独立窗口 TS 入口
- `app-window.html` — 独立窗口 HTML 入口（Vite 多页）
- `src-tauri/src/lib.rs` — 所有 Tauri 命令和进程生命周期管理
- `src-tauri/tauri.conf.json` — 窗口配置、CSP、权限
- `src-tauri/capabilities/default.json` — 权限定义（main + app-* 窗口）

### 跨平台说明

进程管理使用条件编译（`#[cfg(unix)]` / `#[cfg(windows)]`）。Unix 使用 `setsid()` 创建新会话（PID == PGID），通过 `killpg()` 终止进程组；Windows 使用 `CREATE_NEW_PROCESS_GROUP` 和 `taskkill`。
