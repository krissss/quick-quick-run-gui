import { expect, test, type Page } from '@playwright/test'

// Frontend E2E: runs the Vite UI in a browser with mocked Tauri IPC.
// It does not exercise real Tauri desktop windows, capabilities, or plugins.

const defaultSchedule = {
  enabled: false,
  cron: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  missedPolicy: 'skip',
}

const demoFavicon =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="white"/><path d="M12 5v14" stroke="black" stroke-width="2" stroke-linecap="round"/></svg>')

async function installTauriMock(page: Page, state: Record<string, unknown>) {
  await page.addInitScript((initialState) => {
    const testState = {
      calls: [] as Array<{ cmd: string; payload: Record<string, unknown> }>,
      storeData: { ...((initialState.storeData as Record<string, unknown>) ?? {}) },
      runningApps: initialState.runningApps ?? [],
      recentRuns: initialState.recentRuns ?? [],
      autostartEnabled: false,
      favicons: { ...((initialState.favicons as Record<string, string | null>) ?? {}) },
      logs: { ...((initialState.logs as Record<string, string[]>) ?? {}) },
      runLogs: { ...((initialState.runLogs as Record<string, string[]>) ?? {}) },
    }
    const listeners = new Map<string, number[]>()
    const callbacks = new Map<number, (payload: unknown) => void>()
    let nextCallbackId = 1

    function clone<T>(value: T): T {
      if (value == null) return value
      return JSON.parse(JSON.stringify(value)) as T
    }

    function transformCallback(callback: (payload: unknown) => void, once = false) {
      const id = nextCallbackId++
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id)
        callback(payload)
      })
      return id
    }

    function emitEvent(event: string, payload: unknown) {
      for (const id of listeners.get(event) ?? []) {
        callbacks.get(id)?.({ event, payload, id })
      }
    }

    Object.assign(window, {
      __qqrTest: {
        ...testState,
        emitEvent,
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener(event: string, id: number) {
          const next = (listeners.get(event) ?? []).filter((item) => item !== id)
          listeners.set(event, next)
        },
      },
      __TAURI_INTERNALS__: {
        callbacks,
        transformCallback,
        unregisterCallback: (id: number) => callbacks.delete(id),
        runCallback: (id: number, payload: unknown) => callbacks.get(id)?.(payload),
        convertFileSrc: (filePath: string) => `asset://localhost/${encodeURIComponent(filePath)}`,
        invoke: async (cmd: string, payload: Record<string, unknown> = {}) => {
          testState.calls.push({ cmd, payload })

          if (cmd === 'plugin:event|listen') {
            const event = String(payload.event)
            const handler = Number(payload.handler)
            listeners.set(event, [...(listeners.get(event) ?? []), handler])
            return handler
          }
          if (cmd === 'plugin:event|unlisten') {
            const event = String(payload.event)
            const eventId = Number(payload.eventId)
            listeners.set(event, (listeners.get(event) ?? []).filter((id) => id !== eventId))
            return null
          }
          if (cmd === 'plugin:event|emit') {
            emitEvent(String(payload.event), payload.payload)
            return null
          }

          if (cmd === 'plugin:store|load' || cmd === 'plugin:store|get_store') return 1
          if (cmd === 'plugin:store|get') {
            const key = String(payload.key)
            const exists = Object.prototype.hasOwnProperty.call(testState.storeData, key)
            return [clone(testState.storeData[key]), exists]
          }
          if (cmd === 'plugin:store|set') {
            testState.storeData[String(payload.key)] = clone(payload.value)
            return null
          }
          if (cmd === 'plugin:store|save' || cmd === 'plugin:store|reload') return null

          if (cmd === 'plugin:autostart|is_enabled') return testState.autostartEnabled
          if (cmd === 'plugin:autostart|enable') {
            testState.autostartEnabled = true
            return null
          }
          if (cmd === 'plugin:autostart|disable') {
            testState.autostartEnabled = false
            return null
          }

          if (cmd === 'get_running_apps') return clone(testState.runningApps)
          if (cmd === 'get_recent_runs') return clone(testState.recentRuns)
          if (cmd === 'get_app_log_runs') {
            const appId = String(payload.appId)
            return clone((testState.recentRuns as Array<{ app_id: string }>).filter(run => run.app_id === appId))
          }
          if (cmd === 'get_app_logs') {
            if (payload.runId != null) return clone(testState.runLogs[String(payload.runId)] ?? [])
            return clone(testState.logs[String(payload.appId)] ?? [])
          }
          if (cmd === 'clear_app_logs') return { removed: 0 }
          if (cmd === 'prune_log_records') return { removed: 0 }
          if (cmd === 'get_web_favicon') return testState.favicons[String(payload.url)] ?? null
          if (cmd === 'notify_apps_updated') return null
          if (cmd === 'launch_app_window') return { message: '已启动', pid: 1234, run_id: 'run-1' }
          if (cmd === 'stop_app' || cmd === 'show_app_window' || cmd === 'open_in_browser') return null

          throw new Error(`Unhandled Tauri command: ${cmd}`)
        },
      },
    })
  }, state)
}

test('restores a running web app and can reopen its window', async ({ page }) => {
  await installTauriMock(page, {
    storeData: {
      apps: [
        {
          id: 'demo-web-id',
          name: 'demo-web',
          type: 'web',
          command: 'pnpm dev',
          url: 'http://localhost:3000',
          width: 1200,
          height: 800,
          schedule: defaultSchedule,
        },
      ],
    },
    runningApps: [{ app_id: 'demo-web-id', pid: 4321, item_type: 'web' }],
  })

  await page.goto('/')
  await expect(page.locator('[data-app-id="demo-web-id"]')).toBeVisible()
  await expect(page.locator('[data-testid="running-app-card"]').getByText('运行中')).toBeVisible()
  await expect(page.locator('[data-testid="running-app-card"]').getByText('pnpm dev')).toBeVisible()

  await page.locator('[data-app-id="demo-web-id"]').click()
  await page.locator('[data-app-id="demo-web-id"]').getByRole('button', { name: '打开窗口：demo-web' }).click()

  await expect.poll(async () => page.evaluate(() => {
    return window.__qqrTest.calls.filter((call) => call.cmd === 'show_app_window').length
  })).toBe(1)
})

test('renders the web favicon in the sidebar while the edit dialog stays text-only', async ({ page }) => {
  await installTauriMock(page, {
    storeData: {
      apps: [
        {
          id: 'demo-web-id',
          name: 'demo-web',
          type: 'web',
          command: 'pnpm dev',
          url: 'http://localhost:3000',
          width: 1200,
          height: 800,
          schedule: defaultSchedule,
        },
      ],
    },
    favicons: {
      'http://localhost:3000': demoFavicon,
    },
  })

  await page.goto('/')
  await page.getByRole('button', { name: '编辑：demo-web', exact: true }).click()
  const favicons = page.locator('img[alt="demo-web favicon"]')
  const editDialog = page.getByRole('dialog', { name: 'demo-web' })

  await expect(editDialog).toBeVisible()
  await expect(favicons).toHaveCount(1)
  await expect(favicons).toHaveAttribute('src', demoFavicon)
  await expect(editDialog.locator('img[alt="demo-web favicon"]')).toHaveCount(0)
})

test('keeps the log dialog usable in a compact window', async ({ page }) => {
  const longLogLine = `compact-log-marker ${'0123456789'.repeat(40)}`
  const recentRuns = Array.from({ length: 8 }, (_, index) => ({
    id: `run-${index + 1}`,
    app_id: 'task-log-id',
    app_name: 'task-log',
    item_type: 'task',
    status: index === 0 ? 'success' : 'failed',
    pid: null,
    exit_code: index === 0 ? 0 : 1,
    started_at: Date.UTC(2026, 4, 4, 6, 30 - index, 0),
    finished_at: Date.UTC(2026, 4, 4, 6, 30 - index, 2),
    command: `pnpm run compact-log --run ${index + 1}`,
    log_path: `/tmp/run-${index + 1}.log`,
    trigger: 'manual',
  }))

  await page.setViewportSize({ width: 704, height: 420 })
  await installTauriMock(page, {
    storeData: {
      apps: [
        {
          id: 'task-log-id',
          name: 'task-log',
          type: 'task',
          command: 'pnpm run compact-log',
          url: '',
          width: 1200,
          height: 800,
          schedule: defaultSchedule,
        },
      ],
    },
    recentRuns,
    runLogs: {
      'run-1': [longLogLine, 'done'],
    },
  })

  await page.goto('/')
  await page.locator('[data-app-id="task-log-id"]').getByRole('button', { name: '查看日志：task-log' }).click()

  const dialog = page.getByRole('dialog', { name: 'task-log — 日志' })
  const runList = page.locator('[data-testid="log-run-list"]')
  const logLines = page.locator('[data-testid="log-lines"]')

  await expect(dialog).toBeVisible()
  await expect(runList.getByText('最近运行')).toBeVisible()
  await expect(logLines).toContainText('compact-log-marker')

  const metrics = await page.evaluate(() => {
    const dialogEl = document.querySelector('section[role="dialog"]')
    const runListEl = document.querySelector('[data-testid="log-run-list"]')
    const logLinesEl = document.querySelector('[data-testid="log-lines"]')
    if (!dialogEl || !runListEl || !logLinesEl) throw new Error('Log dialog elements not found')
    const dialogRect = dialogEl.getBoundingClientRect()
    const runListRect = runListEl.getBoundingClientRect()
    const logLinesRect = logLinesEl.getBoundingClientRect()
    return {
      viewportHeight: window.innerHeight,
      dialogTop: dialogRect.top,
      dialogBottom: dialogRect.bottom,
      runListTop: runListRect.top,
      runListBottom: runListRect.bottom,
      logLinesTop: logLinesRect.top,
      logLinesBottom: logLinesRect.bottom,
      logClientWidth: logLinesEl.clientWidth,
      logScrollWidth: logLinesEl.scrollWidth,
    }
  })

  expect(metrics.dialogTop).toBeGreaterThanOrEqual(0)
  expect(metrics.dialogBottom).toBeLessThanOrEqual(metrics.viewportHeight)
  expect(metrics.runListTop).toBeGreaterThanOrEqual(metrics.dialogTop)
  expect(metrics.runListBottom).toBeLessThanOrEqual(metrics.dialogBottom)
  expect(metrics.logLinesTop).toBeGreaterThanOrEqual(metrics.runListBottom)
  expect(metrics.logLinesBottom).toBeLessThanOrEqual(metrics.dialogBottom)
  expect(metrics.logScrollWidth).toBeGreaterThan(metrics.logClientWidth)
})

test('shows a validation error for invalid custom task cron', async ({ page }) => {
  await installTauriMock(page, { storeData: {} })

  await page.goto('/')
  await page.getByRole('button', { name: '添加应用' }).click()
  await page.getByText('任务', { exact: true }).click()
  await page.getByPlaceholder('pnpm report').fill('pnpm report')
  await page.getByRole('switch', { name: '定时执行' }).click()
  await page.getByText('自定义', { exact: true }).click()
  await page.getByPlaceholder('*/15 * * * *').fill('abc')
  await page.getByRole('button', { name: '添加', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('定时表达式需要 5 段，例如 */15 * * * *')
})

test('persists menu bar mode from settings', async ({ page }) => {
  await installTauriMock(page, { storeData: {} })

  await page.goto('/')
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByText('菜单栏模式')).toBeVisible()
  await page.getByRole('switch', { name: '菜单栏模式' }).click()

  await expect.poll(async () => page.evaluate(() => {
    return window.__qqrTest.storeData.hide_dock_on_close
  })).toBe(true)
})

declare global {
  interface Window {
    __qqrTest: {
      calls: Array<{ cmd: string; payload: Record<string, unknown> }>
      storeData: Record<string, unknown>
      emitEvent: (event: string, payload: unknown) => void
    }
  }
}
