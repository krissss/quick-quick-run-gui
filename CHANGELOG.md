# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-05-10

### Fixed

- 修复 macOS 自动更新元数据缺少 app updater 包导致检查更新失败的问题

## [0.2.1] - 2026-05-10

### Changed

- 优化发布工作流，拆分 CI 与 Release 打包流程

## [0.2.0] - 2026-05-09

### Added

- 添加 macOS 菜单栏图标（系统托盘）支持
- 启动时自动展示实时日志，失败时不打开窗口
- 添加设置页面，支持开机自启动、主题、菜单栏模式和数据管理
- 重构 UI 为侧边栏布局，优化日志和连接轮询性能
- 重新设计 logo 和菜单栏图标
- 优化启动流程、日志查看和外部链接打开体验
- 优化应用运行态和通知体验
- 支持重启后恢复托管服务
- 支持任务模式和定时执行
- 优化 Dock 和菜单栏入口体验
- 支持应用整行拖拽排序、搜索筛选和复制模板
- 支持应用工作目录和命令参数运行方案
- 支持应用生命周期能力配置
- 支持日志历史保留和清理
- 支持应用延迟运行
- 支持自动更新

### Changed

- 移除 Dock 图标动态切换功能，改用托盘菜单标识运行状态
- 移除未使用的 favicon 功能和 IPC 命令
- 全面优化代码架构、健壮性和安全性
- 拆分主界面组件和单元测试
- 将应用显示名改为 QQRun
- 准备开源发布资料并增强 CI 质量检查流程

### Fixed

- 修复 release 构建的多个问题
- 修复生产构建中进程启动失败的问题
- 修复窗口位置/大小记忆在 Retina 屏幕上偏移的问题
- 修复 Dock 图标边框，符合 Apple HIG 规范
- 修复重启后运行态恢复
- 修复 Linux CI 编译失败
- 优化侧边栏状态信息展示

## [0.1.0] - 2026-04-08

### Added

- 初始化 quick-quick-run-gui — 通用 Web App GUI 包装器
- 放开 CSP 限制，允许 WebView 加载外部 CDN 资源
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

[Unreleased]: https://github.com/krissss/quick-quick-run-gui/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/krissss/quick-quick-run-gui/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/krissss/quick-quick-run-gui/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/krissss/quick-quick-run-gui/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/krissss/quick-quick-run-gui/releases/tag/v0.1.0
