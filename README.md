# QQRun

> 一个用于管理本地 Web 应用、后台服务和计划任务的 Tauri 桌面运行器。

[English](README.en.md)

## 简介

QQRun 把常用的本地运行项放进一个桌面控制台：需要打开窗口的 Web 应用、需要长期运行的后台服务，以及按需或按计划执行的一次性任务。它适合开发者整理本地项目、脚本和服务，减少反复打开终端、查命令、找日志的琐碎操作。

## 功能

- **Web 应用**：启动本地命令并在独立窗口中打开目标 URL。
- **后台服务**：运行长驻命令，查看状态、日志并随时停止。
- **任务**：手动运行命令，或配置为按计划自动运行。
- **运行日志**：查看运行输出、最近运行记录和失败状态。
- **参数方案**：为命令模板保存不同参数组合。
- **生命周期控制**：支持延迟运行、启动恢复、失败重试和服务重启策略。
- **配置管理**：支持导入、导出和备份运行项配置。
- **macOS 集成**：支持菜单栏、Dock 和托盘快捷操作。

## 技术栈

- Vue 3、TypeScript、Vite、Tailwind CSS v4、shadcn-vue
- Rust、Tauri v2、tokio
- pnpm

## 环境要求

- Node.js 24+
- pnpm 10+
- Rust stable
- Tauri v2 所需的系统依赖

Linux 用户需要安装 WebKitGTK 等依赖，详见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 快速开始

```bash
pnpm install
pnpm tauri:dev
```

## 常用命令

```bash
pnpm run build    # 类型检查并构建前端
pnpm test         # 运行测试
pnpm tauri:build  # 构建桌面应用
```

## 项目结构

```text
.
├── src/                  # Vue 前端
├── src-tauri/            # Tauri/Rust 后端
├── tests/                # 测试
├── app-window.html       # 独立应用窗口入口
├── index.html            # 主窗口入口
└── vite.config.ts        # Vite 多页配置
```

## 安全说明

QQRun 会运行用户配置的本地 shell 命令。请只导入、运行你信任的配置。

运行项配置和日志可能包含命令、工作目录、URL 或其他本地环境信息；分享这些内容前请自行检查。

## 贡献

欢迎提交 issue 和 pull request。Bug 报告请尽量包含复现步骤、系统版本和相关日志；功能建议请说明使用场景。
