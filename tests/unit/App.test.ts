import { emit } from '@tauri-apps/api/event'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import { serviceApp, serviceFailedRun, taskApp, taskSuccessRun, webApp } from '../fixtures/apps'
import { setupTauriMocks } from '../helpers/tauri'
import { buttonContaining, inputByPlaceholder, inputByValue } from '../helpers/dom'

async function mountApp(options: Parameters<typeof setupTauriMocks>[0] = {}) {
  const mock = setupTauriMocks(options)
  const wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return { mock, wrapper }
}

function runningCard(wrapper: ReturnType<typeof mount>) {
  const panel = wrapper.find('[data-testid="running-app-card"]')
  if (!panel.exists()) throw new Error('Running app card not found')
  return panel
}

function appRow(wrapper: ReturnType<typeof mount>, appId: string) {
  const row = wrapper.find(`[data-app-id="${appId}"]`)
  if (!row.exists()) throw new Error(`App row not found: ${appId}`)
  return row
}

function bodySwitch(name: string) {
  const switchElement = Array.from(document.querySelectorAll('[role="switch"]')).find((item) => {
    return item.getAttribute('aria-label') === name
  })
  if (!switchElement) throw new Error(`Switch not found: ${name}`)
  return new DOMWrapper(switchElement as HTMLElement)
}

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('wires restored apps to launcher, log dialog, and running controls', async () => {
    const runningApps = [{ app_id: 'web-1', pid: 4321, item_type: 'web' as const }]
    const taskOlderRun = {
      ...taskSuccessRun,
      id: 'run-task-older',
      started_at: 1,
      finished_at: 2,
      command: 'pnpm daily --date yesterday',
    }
    const runningRun = {
      ...taskSuccessRun,
      id: 'running-run',
      app_id: 'web-1',
      app_name: 'demo-web',
      item_type: 'web' as const,
      status: 'running' as const,
      pid: 4321,
      exit_code: null,
      finished_at: null,
      command: 'pnpm dev --restored',
      log_path: '/tmp/running.log',
    }
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp, serviceApp, taskApp] },
      logs: { 'web-1': ['ready'] },
      runLogs: {
        'run-task': ['today-history line'],
        'run-task-older': ['old-history line'],
      },
      runningApps,
      recentRuns: [runningRun, serviceFailedRun, taskSuccessRun, taskOlderRun],
    })

    await appRow(wrapper, 'web-1').trigger('click')
    expect(runningCard(wrapper).text()).toContain('PID 4321')
    expect(runningCard(wrapper).text()).toContain('pnpm dev --restored')
    const recentRuns = wrapper.get('[data-testid="recent-runs"]')
    expect(recentRuns.text()).toContain('最近执行')
    expect(recentRuns.text()).not.toContain('demo-web')
    expect(recentRuns.text()).toContain('daily')
    expect(recentRuns.text()).toContain('成功')
    expect(recentRuns.text()).toContain('pnpm daily --date today')
    expect(recentRuns.text()).toContain('pnpm daily --date yesterday')

    await buttonContaining(wrapper, 'pnpm daily --date yesterday').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('old-history line')
    expect(document.body.textContent).not.toContain('today-history line')

    await wrapper.get('button[aria-label="执行同命令：daily"]').trigger('click')
    await flushPromises()
    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'task-1',
      command: 'pnpm daily --date today',
      launchTrigger: 'manual',
    })

    await wrapper.get('button[aria-label="打开窗口：demo-web"]').trigger('click')
    await wrapper.get('button[aria-label="停止：demo-web"]').trigger('click')
    expect(mock.getCalls('show_app_window')).toHaveLength(1)
    expect(mock.getCalls('stop_app')).toHaveLength(1)

    await wrapper.get('button[aria-label="查看日志：demo-web"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('demo-web — 日志')
    expect(document.body.textContent).toContain('ready')

    await emit('app-launch-failed', { app_id: 'web-1', reason: 'process_exited' })
    runningApps.length = 0
    await emit('app-stopped', 'web-1')
    await flushPromises()
    await buttonContaining(wrapper, '重新启动').trigger('click')
    await flushPromises()
    expect(mock.getCalls('launch_app_window')).toHaveLength(2)
  })

  it('resizes the runtime panel from the divider', async () => {
    const { wrapper } = await mountApp({
      store: { apps: [webApp] },
    })
    const panel = wrapper.get('[data-testid="runtime-panel"]')
    const resizer = wrapper.get('[data-testid="runtime-panel-resizer"]')

    expect(panel.attributes('style')).toContain('width: 400px')

    await resizer.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 400 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 360 }))
    await flushPromises()

    expect(panel.attributes('style')).toContain('width: 440px')

    window.dispatchEvent(new PointerEvent('pointerup'))
  })

  it('duplicates the current app and persists the copied template', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp] },
    })

    await wrapper.get('button[aria-label="编辑：demo-web"]').trigger('click')
    await buttonContaining(wrapper, '复制').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('添加应用')
    expect((inputByValue(wrapper, 'demo-web 副本').element as HTMLInputElement).value).toBe('demo-web 副本')
    expect((inputByPlaceholder(wrapper, '~/repo').element as HTMLInputElement).value).toBe('/Users/demo/demo-web')

    await buttonContaining(wrapper, '添加', true).trigger('click')
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'web-1', name: 'demo-web', order: 0 },
      { name: 'demo-web 副本', workingDirectory: '/Users/demo/demo-web', url: 'http://localhost:3000', order: 1 },
    ])
  })

  it('warns about unsaved changes when closing the edit dialog', async () => {
    const { wrapper } = await mountApp({
      store: { apps: [webApp] },
    })

    await wrapper.get('button[aria-label="编辑：demo-web"]').trigger('click')
    await inputByPlaceholder(wrapper, 'npm run dev').setValue('pnpm dev --changed')
    await document.querySelector<HTMLButtonElement>('button[aria-label="关闭编辑"]')?.click()
    await flushPromises()

    expect(document.body.textContent).toContain('有未保存的更改')
    expect(document.body.textContent).toContain('当前表单还没有保存')
    expect(document.querySelector('[data-testid="app-detail-panel"]')).toBeTruthy()
  })

  it('launches startup-enabled apps after the configured delay', async () => {
    vi.useFakeTimers()
    const startupWeb = {
      ...webApp,
      startup: { enabled: true, delaySeconds: 1 },
    }
    const { mock, wrapper } = await mountApp({
      store: { apps: [startupWeb] },
      runningApps: [],
    })

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'web-1',
      launchTrigger: 'startup',
    })
    wrapper.unmount()
  })

  it('does not launch startup apps when startup is disabled before the delay finishes', async () => {
    vi.useFakeTimers()
    const startupWeb = {
      ...webApp,
      startup: { enabled: true, delaySeconds: 1 },
    }
    const { mock, wrapper } = await mountApp({
      store: { apps: [startupWeb] },
      runningApps: [],
    })

    await wrapper.get('button[aria-label="编辑：demo-web"]').trigger('click')
    await bodySwitch('启动策略').trigger('click')
    await buttonContaining(wrapper, '保存', true).trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window')).toHaveLength(0)
    wrapper.unmount()
  })

  it('creates parameter profiles from the run dialog and launches with selected values', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp] },
    })

    await wrapper.get('button[aria-label="编辑：demo-web"]').trigger('click')
    await inputByPlaceholder(wrapper, 'npm run dev').setValue('pnpm dev {account= : 账号} {--headless}')
    await buttonContaining(wrapper, '保存', true).trigger('click')
    await flushPromises()

    await wrapper.get('button[aria-label="启动：demo-web"]').trigger('click')
    await flushPromises()
    await inputByPlaceholder(wrapper, '账号').setValue('demo')
    const headlessSwitch = Array.from(document.querySelectorAll('[role="switch"]')).at(-1)
    expect(headlessSwitch).toBeTruthy()
    await new DOMWrapper(headlessSwitch as Element).trigger('click')
    await inputByPlaceholder(wrapper, '保存为方案名称').setValue('账号 1')
    await buttonContaining(wrapper, '保存方案', true).trigger('click')
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      {
        id: 'web-1',
        activeProfileId: expect.any(String),
        profiles: [
          {
            name: '账号 1',
            values: { account: 'demo', headless: 'true' },
          },
        ],
      },
    ])

    await buttonContaining(wrapper, '运行', true).trigger('click')
    await flushPromises()
    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      command: 'pnpm dev demo --headless',
      workingDirectory: '/Users/demo/demo-web',
      url: 'http://localhost:3000',
    })
  })

  it('adds and deletes a scheduled task through the form', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      randomUUID: () => 'new-task',
    })
    const { mock, wrapper } = await mountApp()

    await wrapper.get('button[aria-label="添加应用"]').trigger('click')
    await buttonContaining(wrapper, '任务', true).trigger('click')
    await inputByPlaceholder(wrapper, 'pnpm report').setValue('pnpm report')
    await inputByPlaceholder(wrapper, '~/repo').setValue('/Users/demo/reports')
    await bodySwitch('定时执行').trigger('click')
    await buttonContaining(wrapper, '自定义', true).trigger('click')
    await inputByPlaceholder(wrapper, '*/15 * * * *').setValue('bad')
    await buttonContaining(wrapper, '添加', true).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('定时表达式需要 5 段，例如 */15 * * * *')

    await inputByPlaceholder(wrapper, '*/15 * * * *').setValue('*/10 * * * *')
    await buttonContaining(wrapper, '补跑一次', true).trigger('click')
    await buttonContaining(wrapper, '添加', true).trigger('click')
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'new-task', name: 'pnpm report', type: 'task', workingDirectory: '/Users/demo/reports', schedule: { cron: '*/10 * * * *', missedPolicy: 'run-once' } },
    ])

    await wrapper.get('button[aria-label="编辑：pnpm report"]').trigger('click')
    await buttonContaining(wrapper, '删除').trigger('click')
    await flushPromises()
    await buttonContaining(wrapper, '确认删除', true).trigger('click')
    await flushPromises()
    expect(mock.storeData.apps).toEqual([])
  })

  it('wires settings dialog actions to app settings and import/export handlers', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp], hide_dock_on_close: false },
      dialogSavePath: '/tmp/apps.json',
      dialogOpenPath: '/tmp/import.json',
      files: { '/tmp/import.json': JSON.stringify([{ ...serviceApp, id: 'imported-worker' }]) },
    })

    await buttonContaining(wrapper, '设置').trigger('click')
    const switches = Array.from(document.querySelectorAll('[role="switch"]')).map((item) => new DOMWrapper(item as HTMLElement))
    await switches.at(-2)?.trigger('click')
    await switches.at(-1)?.trigger('click')
    await buttonContaining(wrapper, '导出').trigger('click')
    await buttonContaining(wrapper, '导入').trigger('click')
    await flushPromises()

    expect(mock.getCalls('plugin:autostart|enable')).toHaveLength(1)
    expect(mock.storeData.hide_dock_on_close).toBe(true)
    expect(mock.getCalls('plugin:fs|write_file')).toHaveLength(1)
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)
    expect(document.body.textContent).toContain('已导入 1 个应用')
  })
})
