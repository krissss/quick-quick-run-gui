# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Tauri v2 桌面运行器，用于管理三类条目：
- **网页（web）：** 可选 shell 启动命令 + 目标 URL，点击后在独立 WebView 窗口中打开。
- **服务（service）：** 长时间运行的 shell 命令，不创建应用窗口，支持运行态、日志和停止。
- **任务（task）：** 一次性 shell 命令，支持手动运行、cron 定时运行、错过执行策略和运行历史。

## 技术栈

- **前端：** Vue 3（Composition API + `<script setup>`）、TypeScript、Vite、Tailwind CSS v4、shadcn-vue
- **后端：** Rust、Tauri v2、tokio（异步）、serde
- **调度：** cron 解析、`chrono`、`chrono-tz`
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
| `launch_app_window` | `appId`, `command`, `url`, `width`, `height`, `appName`, `itemType`, `bgR/G/B` | `{ message, pid, run_id }` | - |
| `get_running_apps` | - | `{ app_id, pid, item_type }[]` | - |
| `get_app_logs` | `appId` | `string[]` | - |
| `get_recent_runs` | - | `RunRecord[]` | - |
| `stop_app` | `appId` | - | - |
| `show_app_window` | `appId` | - | - |
| `notify_apps_updated` | - | - | - |
| `open_in_browser` | `url` | - | - |

**事件（后端 → 前端）：**
| 事件 | Payload |
|---|---|
| `app-launched` | `string` (app_id) |
| `app-stopped` | `string` (app_id) |
| `app-process-stopped` | `string` (app_id，web 后台进程退出但窗口仍可保留) |
| `app-run-updated` | `{ app_id, run_id, status }` |
| `app-window-opened` | `string` (app_id) |
| `app-log` | `{app_id: string, line: string}` |
| `app-launch-failed` | `{app_id: string, reason: string}` |
| `tray-launch-app` | `string` (app_id) |
| `tray-open-log` | `string` (app_id) |

### 进程管理（`src-tauri/src/process.rs`）

- `AppState`：`HashMap<String, ProcessInfo>` 管理所有运行进程
- `ItemType`：`Web`、`Service`、`Task`
- `RunRecord`：记录每次运行的状态、PID、退出码、日志路径、触发方式（manual/schedule/startup-recover）
- 窗口关闭时 `on_window_event(CloseRequested)` 自动杀掉关联 web 进程
- web 进程自然退出时保留窗口运行态；service/task 退出后从运行态移除
- 退出应用（托盘 Quit）不主动停止托管进程；托盘 `stop-all` 才会强制停止全部进程
- 使用 `command_group` crate 创建独立进程组：
  - Unix：`group_spawn()` 底层使用 `setsid()` 创建新会话
  - Windows：`CREATE_NO_WINDOW` + `group_spawn()`

### 定时任务

- 调度器在启动后延迟 3 秒开始，每 60 秒检查一次启用的 task。
- 仅 `type === "task"` 且 `schedule.enabled === true` 的条目参与调度。
- cron 使用 5 段格式：分钟、小时、日期、月份、星期；星期 `0` 和 `7` 都表示周日。
- `schedule.timezone` 通过 `chrono-tz` 解析；无效值回退到 `Asia/Shanghai`。
- `missedPolicy`：
  - `skip`：只在当前分钟匹配时运行，不补跑错过的时间。
  - `run-once`：最多回溯 32 天，补跑最近一次错过的 due。
- `schedule_state` 只在任务真实启动成功并返回 `run_id` 后推进；启动失败或任务已在运行时不推进。

### 数据存储

`qqr-store.json` 主要 key：
- `apps`：用户配置的 web/service/task 条目。
- `running_sessions`：重启恢复用的运行中进程快照。
- `run_records`：最多保留 500 条运行历史。
- `schedule_state`：调度器按 app id 保存的最近成功触发 due 时间。
- `hide_dock_on_close`：关闭主窗口时是否进入仅菜单栏模式（默认 `false`）。

### 窗口管理

- 主窗口：`main` (index.html → App.vue)
- 应用窗口：动态创建，label 格式 `app-{appId前8字符}`（`window_label_for()`），加载 `app-window.html` (AppWindow.vue)
- 主窗口关闭时默认只隐藏窗口并保留 Dock 图标；启用「菜单栏模式」后才隐藏 Dock 图标（macOS）。
- 点击 Dock 图标或菜单栏图标会重新显示主窗口；菜单栏右键菜单提供打开运行中 web 窗口、查看 service/task 日志、停止运行项等操作。

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
- `src/components/CronSchedulePicker.vue` — 人性化 cron 编辑组件
- `src/lib/store.ts` — 数据持久化封装
- `src/lib/cron.ts` — 前端 cron 表达式校验
- `src/lib/theme.ts` — 主题切换（light/dark/system）
- `src/components/ui/` — shadcn-vue 组件

**后端：**
- `src-tauri/src/lib.rs` — IPC 命令入口、窗口管理、任务调度
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
web 条目：
  用户点击卡片
    → launch_app_window(itemType=web)
    → 启动 shell 进程（command 可选）
    → 轮询 check_url_reachable
    → 创建 WebviewWindow
    → 设置窗口标题（从目标页面 <title>）

service 条目：
  用户点击卡片
    → launch_app_window(itemType=service)
    → 杀掉旧实例
    → 启动 shell 进程
    → 写入 running_sessions + run_records
    → 进程退出后更新运行记录并移除运行态

task 条目：
  用户点击运行或调度器命中 cron
    → launch_app_window(itemType=task) 或 run_scheduler_tick
    → 若任务已运行则不重复启动
    → 启动 shell 进程
    → 写入 run_records
    → 进程退出后更新状态
```

### shadcn-vue 组件

使用 `@/components/ui/` 下的组件，通过 `components.json` 配置。新增组件：
```bash
pnpm dlx shadcn-vue@latest add [组件名]
```

## UI 设计规范

**必须严格遵循 `DESIGN.md` 中的 Vercel 设计系统进行所有 UI 相关开发。** 主要原则：

- **字体：** Geist Sans（主字体）+ Geist Mono（等宽），启用 OpenType `"liga"`
- **配色：** 黑白灰为主调（`#171717` / `#ffffff`），禁止引入暖色调装饰色
- **边框：** 使用 shadow-as-border（`box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.08)`）替代传统 CSS border
- **字重：** 仅用 400（正文）、500（交互）、600（标题），不用 700
- **字间距：** 大标题使用负 letter-spacing（48px → -2.4px），随字号递减
- **圆角：** 按钮 6px、卡片 8px、徽章 9999px（pill）
- **阴影层级：** 多层 shadow stack（border + elevation + ambient + inner highlight）
- **focus ring：** `hsla(212, 100%, 48%, 1)` 蓝色聚焦环

修改任何前端组件、样式、布局前，先查阅 `DESIGN.md` 对应章节（配色、排版、组件、深度）。

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
