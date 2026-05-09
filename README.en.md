# QQRun

> A Tauri desktop runner for local web apps, background services, and scheduled tasks.

[中文](README.md)

## Overview

QQRun keeps common local run targets in one desktop control panel: web apps that open in their own windows, background services that keep running, and tasks that run on demand or on a schedule. It is designed for developers who want a tidy way to manage local projects, scripts, logs, and service state without repeatedly hunting through terminal history.

## Features

- **Web apps**: start a local command and open the target URL in a separate window.
- **Services**: run long-lived commands with status, logs, and stop controls.
- **Tasks**: run commands manually or configure them to run on a schedule.
- **Run logs**: inspect command output, recent runs, and failure states.
- **Parameter profiles**: save reusable values for command templates.
- **Lifecycle controls**: delayed launch, startup recovery, retry, and restart policies.
- **Configuration management**: import, export, and back up run target configurations.
- **Auto update**: check, download, and install new versions from GitHub Releases.
- **macOS integration**: menu bar, Dock behavior, and tray shortcuts.

## Tech Stack

- Vue 3, TypeScript, Vite, Tailwind CSS v4, shadcn-vue
- Rust, Tauri v2, tokio
- pnpm

## Requirements

- Node.js 24+
- pnpm 10+
- Rust stable
- System dependencies required by Tauri v2

Linux users need WebKitGTK and related dependencies. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Getting Started

```bash
pnpm install
pnpm tauri:dev
```

## Scripts

```bash
pnpm run build    # Type-check and build the frontend
pnpm test         # Run tests
pnpm tauri:build  # Build the desktop app
```

## Release

Tags starting with `v` trigger GitHub Actions to build desktop installers, sign updater artifacts, and publish `latest.json`. Before the first release, configure `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets; if the signing key has a password, also configure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Project Structure

```text
.
├── src/                  # Vue frontend
├── src-tauri/            # Tauri/Rust backend
├── tests/                # Tests
├── app-window.html       # Separate app-window entry
├── index.html            # Main-window entry
└── vite.config.ts        # Vite multi-page config
```

## Security Notes

QQRun runs local shell commands configured by the user. Only import and run configurations you trust.

Run target configurations and logs may contain commands, working directories, URLs, or other local environment details. Review them before sharing.

## Contributing

Issues and pull requests are welcome. For bug reports, please include reproduction steps, system version, and relevant logs. For feature requests, please describe the use case.
