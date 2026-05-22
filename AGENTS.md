# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Tauri v2 桌面运行器，用来管理三类条目：

- **web**：可选 shell 启动命令 + 目标 URL，在独立 WebView 窗口中打开。
- **service**：长时间运行的后台命令，不创建应用窗口，重点是运行态、日志和停止。
- **task**：一次性命令，支持手动运行、cron 定时、错过执行策略和运行历史。

## 技术栈

- **前端：** Vue 3（Composition API + `<script setup>`）、TypeScript、Vite、Tailwind CSS v4、shadcn-vue
- **后端：** Rust、Tauri v2、tokio（异步）、serde
- **存储/调度：** tauri-plugin-store（`qqr-store.json`）、cron、`chrono`、`chrono-tz`
- **包管理器：** pnpm

## 常用命令

```bash
pnpm dev          # 仅启动 Vite 开发服务器（前端）
pnpm run build    # 类型检查（vue-tsc）+ Vite 构建
pnpm check:quick  # 提交前快速验证：前端 build + Rust fmt/clippy/test
pnpm check:ci     # 发版前完整验证：Rust checks + audit/build/unit/integration/e2e
pnpm tauri:dev    # Tauri 完整开发模式（Rust + 前端）
pnpm tauri:build  # Tauri 生产构建
```

### 提交前验证

- 提交前优先运行 `pnpm check:quick`，避免 Rust fmt、clippy 或测试在 push 后才由 CI 暴露。
- 发版前必须运行 `pnpm check:ci`，它对齐 GitHub Actions 的 Rust checks、Frontend build（含生产依赖审计）和 Frontend tests。
- 如果只改前端且需要单独验证，可运行 `pnpm check:frontend`；如果只改 `src-tauri`，可运行 `pnpm check:rust`。
- 若本地环境导致某项无法运行，提交或回复中必须明确说明跳过的命令、原因，以及是否已用 CI 或其他命令替代验证。

## 架构

### 入口与边界

- 前端主入口是 `src/App.vue`，独立应用窗口入口是 `src/AppWindow.vue`。
- 主窗口共享状态集中在 `src/stores/` 的 Pinia stores；`src/App.vue` 只做应用启动、生命周期和少量顶层装配，不应作为 props/emit 总线。
- Tauri IPC 命令集中在 `src-tauri/src/lib.rs`；前端应优先通过 Pinia store action 封装 IPC、持久化和跨组件状态变化。
- 进程生命周期、日志文件、运行记录和重启恢复主要在 `src-tauri/src/process.rs`。
- 用户配置的规范化、导入导出和本地 store 封装在 `src/lib/store.ts`。
- UI 基础组件在 `src/components/ui/`，业务表单位于 `src/components/app/capabilities/`。
- Vite 是多页入口：`index.html` 对应主窗口，`app-window.html` 对应独立应用窗口。

### Pinia 状态管理

- 主窗口使用 Pinia 做状态管理，共享状态和跨组件动作优先放在 `src/stores/`。
- `src/App.vue` 应保持为应用启动、生命周期和顶层装配入口，避免重新堆回大量 props/emit 中转。
- 组件可以直接消费对应 store；局部、无全局业务状态的 UI 辅助逻辑仍可保留为 composable。

### 行为不变量

- web 的 `command` 可为空；service/task 必须有命令才能启动或保存。
- web 有后台进程时会等待 URL 可达再创建 WebView；无命令时直接创建窗口。
- web 后台进程自然退出时保留窗口运行态；service/task 退出后从运行态移除。
- 窗口关闭会停止关联 web 进程；退出应用（托盘 Quit）不主动停止托管进程，托盘 `stop-all` 才会强制停止全部进程。
- 托管命令通过 `command_group` 创建独立进程组，停止时应面向整个进程组处理。
- `RunRecord` 记录运行状态、PID、退出码、日志路径和触发方式；日志历史按配置裁剪，但运行中的记录必须保留。

### 调度规则

- 调度器在启动后延迟 3 秒开始，每 60 秒检查一次启用的 task。
- 仅 `type === "task"` 且 `schedule.enabled === true` 的条目参与调度。
- cron 使用 5 段格式：分钟、小时、日期、月份、星期；星期 `0` 和 `7` 都表示周日。
- `schedule.timezone` 通过 `chrono-tz` 解析；无效值回退到 `Asia/Shanghai`。
- `missedPolicy`：
  - `skip`：只在当前分钟匹配时运行，不补跑错过的时间。
  - `run-once`：最多回溯 32 天，补跑最近一次错过的 due。
- `schedule_state` 只在任务真实启动成功并返回 `run_id` 后推进；启动失败或任务已在运行时不推进。

### shadcn-vue 组件

- 使用 `@/components/ui/` 下的组件，通过 `components.json` 配置。新增官方组件：

```bash
pnpm dlx shadcn-vue@latest add [组件名]
```

## UI 设计规范

所有 UI 相关开发必须先查阅 `DESIGN.md`。核心约束：

- **字体：** Geist Sans（主字体）+ Geist Mono（等宽），启用 OpenType `"liga"`
- **配色：** 黑白灰为主调（`#171717` / `#ffffff`），禁止引入暖色调装饰色
- **边框：** 使用 shadow-as-border（`box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.08)`）替代传统 CSS border
- **字重：** 仅用 400（正文）、500（交互）、600（标题），不用 700
- **字间距：** 大标题使用负 letter-spacing（48px → -2.4px），随字号递减
- **圆角：** 按钮 6px、卡片 8px、徽章 9999px（pill）
- **阴影层级：** 多层 shadow stack（border + elevation + ambient + inner highlight）
- **focus ring：** `hsla(212, 100%, 48%, 1)` 蓝色聚焦环

## 调试

- 前端日志：浏览器 DevTools
- 后端日志：`src-tauri/logs/` 目录
- 进程启动日志：主窗口「查看日志」按钮

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **quick-quick-run-gui** (936 symbols, 2341 relationships, 72 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
