# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Tauri v2 桌面应用，将 Web 应用包装为原生窗口。用户配置应用列表（名称、shell 命令、目标 URL），点击卡片在独立窗口中启动。

## 技术栈

- **前端：** Vue 3（Composition API + `<script setup>`）、TypeScript、Vite、Tailwind CSS v4、shadcn-vue
- **后端：** Rust、Tauri v2、tokio（异步）、serde
- **数据存储：** tauri-plugin-store（JSON 文件：`qqr-store.json`）
- **包管理器：** pnpm

## 常用命令

```bash
pnpm dev          # 仅启动 Vite 开发服务器（前端）
pnpm run build    # 类型检查（vue-tsc）+ Vite 构建
pnpm tauri:dev    # Tauri 完整开发模式（Rust + 前端）
pnpm tauri:build  # Tauri 生产构建
```

## 架构

### IPC 通信

**命令（前端 → 后端）：**
| 命令 | 参数 | 返回 | 平台 |
|---|---|---|---|
| `launch_app_window` | `appId`, `command`, `url`, `width`, `height`, `appName`, `bgR/G/B` | `string` | - |
| `get_running_apps` | - | `string[]` | - |
| `get_app_logs` | `appId` | `string[]` | - |
| `notify_apps_updated` | - | - | - |
| `hide_dock_icon_cmd` | - | - | macOS |
| `show_dock_icon_cmd` | - | - | macOS |

**事件（后端 → 前端）：**
| 事件 | Payload |
|---|---|
| `app-launched` | `string` (app_id) |
| `app-stopped` | `string` (app_id) |
| `app-log` | `{app_id: string, line: string}` |
| `app-launch-failed` | `{app_id: string, reason: string}` |
| `tray-launch-app` | `string` (app_id) |

### 进程管理（`src-tauri/src/process.rs`）

- `AppState`：`HashMap<String, ProcessInfo>` 管理所有运行进程
- 窗口关闭时 `on_window_event(CloseRequested)` 自动杀掉关联进程
- 使用 `command_group` crate 创建独立进程组：
  - Unix：`group_spawn()` 底层使用 `setsid()` 创建新会话
  - Windows：`CREATE_NO_WINDOW` + `group_spawn()`

### 窗口管理

- 主窗口：`main` (index.html → App.vue)
- 应用窗口：动态创建，label 格式 `app-{appId前8字符}`（`window_label_for()`），加载 `app-window.html` (AppWindow.vue)
- 主窗口关闭时隐藏 Dock 图标，应用仅保留菜单栏图标（macOS）

### Vite 多页入口

```javascript
// vite.config.ts
input: {
  main: 'index.html',           // 主窗口
  'app-window': 'app-window.html' // 应用窗口
}
```

### 关键文件

**前端：**
- `src/App.vue` — 主界面，卡片列表、CRUD、主题、日志
- `src/AppWindow.vue` — 应用窗口，工具栏 + iframe
- `src/lib/store.ts` — 数据持久化封装
- `src/lib/theme.ts` — 主题切换（light/dark/system）
- `src/components/ui/` — shadcn-vue 组件

**后端：**
- `src-tauri/src/lib.rs` — IPC 命令入口
- `src-tauri/src/process.rs` — 进程生命周期
- `src-tauri/src/tray.rs` — 系统托盘（macOS only）
- `src-tauri/src/dock.rs` — Dock 图标控制（macOS only）
- `src-tauri/src/url_check.rs` — TCP 连接检查
- `src-tauri/src/favicon.rs` — HTML 标题提取

**配置：**
- `src-tauri/tauri.conf.json` — 窗口配置、CSP
- `src-tauri/capabilities/default.json` — 权限定义
- `src-tauri/Cargo.toml` — Rust 依赖

### 条件编译

```rust
// 平台相关
#[cfg(unix)]      // Unix-specific code
#[cfg(windows)]   // Windows-specific code
#[cfg(target_os = "macos")]  // macOS-only (tray, dock)
```

### 数据流

```
用户点击卡片
  → launch_app_window
  → 启动 shell 进程（command 可选）
  → 轮询 check_url_reachable
  → 创建 WebviewWindow
  → 设置窗口标题（从目标页面 <title>）
```

### shadcn-vue 组件

使用 `@/components/ui/` 下的组件，通过 `components.json` 配置。新增组件：
```bash
pnpm dlx shadcn-vue@latest add [组件名]
```

## 调试

- 前端日志：浏览器 DevTools
- 后端日志：`src-tauri/logs/` 目录
- 进程启动日志：主窗口「查看日志」按钮

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **quick-quick-run-gui** (182 symbols, 319 relationships, 15 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
