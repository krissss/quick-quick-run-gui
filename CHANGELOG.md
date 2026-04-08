# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-08

### Added

- 初始化 quick-quick-run-gui — 通用 Web App GUI 包装器
- 放开 CSP 限制，允许 WebView 加载外部 CDN 资源
- 动态 Dock 图标 — 运行时替换为服务 favicon
- 窗口标题同步为 web 页面标题 & 修复 kill_process 死锁
- 迁移 UI 到 shadcn-vue + Tailwind CSS v4
- 重新设计 UI 为应用卡片式布局
- 独立窗口模式 — 支持同时运行多个应用
- 明亮主题 + 原生文件对话框 + 移除独立窗口工具栏
- 支持命令日志查看 + 可选启动命令
- 更新应用图标 + 优化 Dock 图标显示

### Changed

- 将 src-tauri/gen/ 加入 gitignore 并移除已跟踪的生成文件
- 统一独立窗口模式 + 体验优化
- 拆分 lib.rs 为独立模块 + 引入外部 crate 优化（command-group、scraper、image）
- 添加 GitHub Actions 多平台构建与测试
- 合并构建与测试为单一 CI 工作流

### Fixed

- 为 macOS 专属代码添加条件编译守卫，修复跨平台构建

[0.1.0]: https://github.com/krissss/quick-quick-run-gui/releases/tag/v0.1.0
