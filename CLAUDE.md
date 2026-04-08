# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Quick Quick Run GUI 是一个 Tauri v2 桌面应用，用于将 Web 应用包装为原生窗口。用户配置应用列表（名称、shell 命令、目标 URL），点击卡片在独立窗口中启动，可同时运行多个应用。界面文本为中文。

## 技术栈

- **前端：** Vue 3（Composition API + `<script setup>`）、TypeScript、Vite、Tailwind CSS v4、shadcn-vue
- **后端：** Rust、Tauri v2、tokio（异步）、serde
- **数据存储：** tauri-plugin-store（JSON 文件）
- **包管理器：** pnpm

## 常用命令

```bash
pnpm dev          # 仅启动 Vite 开发服务器（前端）
pnpm run build    # 类型检查（vue-tsc）+ Vite 构建
pnpm tauri:dev    # Tauri 完整开发模式（Rust + 前端）
pnpm tauri:build  # Tauri 生产构建
pnpm preview      # 预览 Vite 生产构建
```

当前未配置测试运行器和代码检查工具。

## 架构

### IPC 命令

Vue 前端通过 `@tauri-apps/api/core` 的 `invoke()` 与 Rust 后端通信：

| 命令 | 功能 |
|---|---|
| `launch_app_window` | 启动进程 + 创建独立 WebviewWindow（等待 URL 可达、设置 dock 图标、同步窗口标题） |
| `stop_app_window` | 停止指定应用进程并关闭其窗口 |
| `get_running_apps` | 返回当前运行的应用 ID 列表 |
| `check_url_reachable` | 轮询 TCP 连接，检测服务器是否就绪 |
| `set_dock_icon_from_url` | 从 URL 获取 favicon 并设为 macOS Dock 图标 |
| `reset_dock_icon` | 恢复默认 Dock 图标 |
| `set_window_title_from_url` | 从目标页面 `<title>` 同步窗口标题 |
| `fetch_favicon_data_url` | 获取 favicon 并返回 base64 data URL（卡片图标） |

### 进程管理

`AppState` 使用 `HashMap<String, ProcessInfo>` 管理：
- 每个 app ID 对应一个独立进程 + 独立窗口
- 窗口关闭时通过 `on_window_event(CloseRequested)` 自动杀掉关联进程
- 主窗口销毁时 `force_kill_all` 清理所有子进程

### 独立窗口

每个应用在独立 WebviewWindow 中运行，加载 `app-window.html`（Vite 多页入口）：
- 顶部工具栏（URL 显示 + 停止按钮）
- iframe loading 状态 + 错误重试
- 全高 iframe 加载目标应用 URL

### 数据流

1. 用户在首页（`App.vue`）点击应用卡片
2. `launch_app_window` → 启动 shell 进程 → 等待 URL 可达 → 创建新窗口
3. 自动设置 macOS Dock 图标（favicon）+ 窗口标题（页面 `<title>`）
4. 主窗口保持不变，可继续启动其他应用
5. 关闭应用窗口 → 自动杀掉进程

### 数据存储

使用 `tauri-plugin-store`（JSON 文件），封装在 `src/lib/store.ts`：
- `loadApps()` / `saveApps()` — 读写应用列表
- `exportData()` / `importData()` — 导入导出 JSON
- 首次启动自动从 localStorage 迁移旧数据

### 前端 UI

- shadcn-vue 组件库 + Tailwind CSS v4（深色主题）
- 应用卡片网格布局，图标/渐变首字母 + 名称 + URL
- 运行中的应用显示绿色圆点指示器（`app-launched`/`app-stopped` 事件）

### 关键文件

- `src/App.vue` — 主页面：应用卡片列表 + 管理逻辑
- `src/AppWindow.vue` — 独立窗口页面：工具栏 + iframe + loading/error 状态
- `src/app-window.ts` — 独立窗口 TS 入口
- `src/lib/store.ts` — tauri-plugin-store 封装（load/save/export/import）
- `app-window.html` — 独立窗口 HTML 入口（Vite 多页）
- `src-tauri/src/lib.rs` — 所有 Tauri 命令和进程生命周期管理
- `src-tauri/tauri.conf.json` — 窗口配置、CSP
- `src-tauri/capabilities/default.json` — 权限定义（main + app-* 窗口）

### 跨平台说明

进程管理使用条件编译（`#[cfg(unix)]` / `#[cfg(windows)]`）。Unix 使用 `setsid()` 创建新会话（PID == PGID），通过 `killpg()` 终止进程组；Windows 使用 `CREATE_NEW_PROCESS_GROUP` 和 `taskkill`。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **quick-quick-run-gui** (196 symbols, 321 relationships, 14 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/quick-quick-run-gui/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/quick-quick-run-gui/context` | Codebase overview, check index freshness |
| `gitnexus://repo/quick-quick-run-gui/clusters` | All functional areas |
| `gitnexus://repo/quick-quick-run-gui/processes` | All execution flows |
| `gitnexus://repo/quick-quick-run-gui/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
