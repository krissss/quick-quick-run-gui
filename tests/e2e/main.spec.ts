import { expect, test, type Page } from '@playwright/test'

// Frontend E2E: runs the Vite UI in a browser with mocked Tauri IPC.
// It does not exercise real Tauri desktop windows, capabilities, or plugins.

const defaultSchedule = {
  enabled: false,
  cron: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  missedPolicy: 'skip',
}

async function installTauriMock(page: Page, state: Record<string, unknown>) {
  await page.addInitScript((initialState) => {
    const testState = {
      calls: [] as Array<{ cmd: string; payload: Record<string, unknown> }>,
      storeData: { ...((initialState.storeData as Record<string, unknown>) ?? {}) },
      runningApps: initialState.runningApps ?? [],
      recentRuns: initialState.recentRuns ?? [],
      autostartEnabled: false,
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
          if (cmd === 'get_app_logs') return []
          if (cmd === 'clear_app_logs') return { removed: 0 }
          if (cmd === 'prune_log_records') return { removed: 0 }
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
          id: 'qwenpaw-id',
          name: 'qwenpaw',
          type: 'web',
          command: 'pnpm dev',
          url: 'http://localhost:3000',
          width: 1200,
          height: 800,
          schedule: defaultSchedule,
        },
      ],
    },
    runningApps: [{ app_id: 'qwenpaw-id', pid: 4321, item_type: 'web' }],
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: /qwenpaw/ })).toBeVisible()
  await expect(page.locator('[data-testid="app-detail-panel"]').getByText('运行中')).toBeVisible()

  await page.getByRole('button', { name: /qwenpaw/ }).click()
  await page.getByRole('button', { name: '窗口' }).click()

  await expect.poll(async () => page.evaluate(() => {
    return window.__qqrTest.calls.filter((call) => call.cmd === 'show_app_window').length
  })).toBe(1)
})

test('shows a validation error for invalid custom task cron', async ({ page }) => {
  await installTauriMock(page, { storeData: {} })

  await page.goto('/')
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
