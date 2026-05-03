import { emit } from '@tauri-apps/api/event'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import type { AppItem } from '@/lib/store'
import { setupTauriMocks } from '../helpers/tauri'

const baseSchedule = {
  enabled: false,
  cron: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  missedPolicy: 'skip' as const,
}

const webApp: AppItem = {
  id: 'web-1',
  name: 'qwenpaw',
  type: 'web',
  command: 'pnpm dev',
  workingDirectory: '/Users/kriss/qwenpaw',
  url: 'http://localhost:3000',
  width: 1200,
  height: 800,
  profiles: [],
  activeProfileId: '',
  schedule: baseSchedule,
}

const serviceApp: AppItem = {
  id: 'service-1',
  name: 'worker',
  type: 'service',
  command: 'pnpm worker',
  workingDirectory: '/Users/kriss/worker',
  url: '',
  width: 1200,
  height: 800,
  profiles: [],
  activeProfileId: '',
  schedule: baseSchedule,
}

const taskApp: AppItem = {
  id: 'task-1',
  name: 'daily',
  type: 'task',
  command: 'pnpm daily',
  workingDirectory: '/Users/kriss/daily',
  url: '',
  width: 1200,
  height: 800,
  profiles: [],
  activeProfileId: '',
  schedule: { ...baseSchedule, enabled: true, cron: '0 9 * * *', missedPolicy: 'run-once' },
}

function buttonContaining(wrapper: VueWrapper, text: string, exact = false) {
  const matches = (value: string) => exact ? value.trim() === text : value.includes(text)
  const button = wrapper.findAll('button').find((item) => matches(item.text()))
  if (button) return button
  const element = Array.from(document.querySelectorAll('button')).find((item) => matches(item.textContent ?? ''))
  if (element) return new DOMWrapper(element)
  throw new Error(`Button not found: ${text}\n${document.body.textContent}`)
}

function inputByPlaceholder(wrapper: VueWrapper, placeholder: string) {
  const input = wrapper.findAll('input').find((item) => item.attributes('placeholder') === placeholder)
  if (input) return input
  const element = Array.from(document.querySelectorAll('input')).find((item) => item.getAttribute('placeholder') === placeholder)
  if (element) return new DOMWrapper(element)
  throw new Error(`Input not found: ${placeholder}`)
}

function inputByValue(wrapper: VueWrapper, value: string) {
  const input = wrapper.findAll('input').find((item) => (item.element as HTMLInputElement).value === value)
  if (input) return input
  const element = Array.from(document.querySelectorAll('input')).find((item) => item.value === value)
  if (element) return new DOMWrapper(element)
  throw new Error(`Input with value not found: ${value}`)
}

async function mountApp(options: Parameters<typeof setupTauriMocks>[0] = {}) {
  const mock = setupTauriMocks(options)
  const wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  return { mock, wrapper }
}

function detailPanel(wrapper: VueWrapper) {
  const panel = wrapper.find('.max-w-md')
  if (!panel.exists()) throw new Error('Detail panel not found')
  return panel
}

function appRow(wrapper: VueWrapper, appId: string) {
  const row = wrapper.find(`[data-app-id="${appId}"]`)
  if (!row.exists()) throw new Error(`App row not found: ${appId}`)
  return row
}

function visibleAppIds() {
  return Array.from(document.querySelectorAll('[data-app-id]'))
    .map((item) => (item as HTMLElement).dataset.appId)
    .filter((id): id is string => !!id)
}

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders restored apps, status labels, and running controls', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp, serviceApp, taskApp] },
      logs: { 'web-1': ['ready'] },
      runningApps: [{ app_id: 'web-1', pid: 4321, item_type: 'web' }],
      recentRuns: [
        { id: 'run-service', app_id: 'service-1', app_name: 'worker', item_type: 'service', status: 'failed', pid: null, exit_code: 1, started_at: 2, finished_at: 3, log_path: '', trigger: 'manual' },
        { id: 'run-task', app_id: 'task-1', app_name: 'daily', item_type: 'task', status: 'success', pid: null, exit_code: 0, started_at: 4, finished_at: 5, log_path: '', trigger: 'schedule' },
      ],
    })

    expect(document.body.textContent).toContain('qwenpaw')
    expect(document.body.textContent).toContain('运行中')

    await buttonContaining(wrapper, 'qwenpaw').trigger('click')
    expect(document.body.textContent).toContain('PID 4321')

    await buttonContaining(wrapper, '窗口').trigger('click')
    await buttonContaining(wrapper, '停止').trigger('click')
    expect(mock.getCalls('show_app_window')).toHaveLength(1)
    expect(mock.getCalls('stop_app')).toHaveLength(1)

    await buttonContaining(wrapper, '日志').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('qwenpaw — 日志')
    expect(document.body.textContent).toContain('ready')

    await emit('app-launch-failed', { app_id: 'web-1', reason: 'process_exited' })
    await flushPromises()
    expect(document.body.textContent).toContain('进程已退出')
    await buttonContaining(wrapper, '重新启动').trigger('click')
    expect(mock.getCalls('launch_app_window')).toHaveLength(1)
    const logOverlay = Array.from(document.querySelectorAll('.fixed.inset-0')).find((item) => item.textContent?.includes('qwenpaw — 日志'))
    if (!logOverlay) throw new Error('Log overlay not found')
    await new DOMWrapper(logOverlay as HTMLElement).trigger('click')

    await buttonContaining(wrapper, 'worker').trigger('click')
    expect(document.body.textContent).toContain('上次失败')
    expect(document.body.textContent).toContain('启动')
    await buttonContaining(wrapper, '启动', true).trigger('click')

    await buttonContaining(wrapper, 'daily').trigger('click')
    expect(document.body.textContent).toContain('上次成功')
    expect(document.body.textContent).toContain('补跑一次')
    expect(document.body.textContent).toContain('运行')
    await buttonContaining(wrapper, '运行', true).trigger('click')
    expect(mock.getCalls('launch_app_window').length).toBeGreaterThanOrEqual(3)
  })

  it('reorders apps by dragging a list item', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp, serviceApp, taskApp] },
    })

    const taskRow = appRow(wrapper, 'task-1')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => appRow(wrapper, 'web-1').element),
    })

    await taskRow.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await taskRow.trigger('pointermove', { pointerId: 1, clientX: 10, clientY: 20 })
    await taskRow.trigger('pointerup', { pointerId: 1, clientX: 10, clientY: 20 })
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'task-1', order: 0 },
      { id: 'web-1', order: 1 },
      { id: 'service-1', order: 2 },
    ])
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)
  })

  it('groups apps in the sidebar and filters them by search and type', async () => {
    const { wrapper } = await mountApp({
      store: { apps: [webApp, serviceApp, taskApp] },
    })

    expect(document.body.textContent).toContain('网页1')
    expect(document.body.textContent).toContain('服务1')
    expect(document.body.textContent).toContain('任务1')

    await inputByPlaceholder(wrapper, '搜索名称、命令或 URL').setValue('worker')
    await flushPromises()
    expect(visibleAppIds()).toEqual(['service-1'])

    await wrapper.get('button[aria-label="清空搜索"]').trigger('click')
    await wrapper.get('button[aria-label="筛选任务"]').trigger('click')
    await flushPromises()

    expect(visibleAppIds()).toEqual(['task-1'])
  })

  it('duplicates the current app into a new template', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp] },
    })

    await buttonContaining(wrapper, 'qwenpaw').trigger('click')
    await buttonContaining(wrapper, '复制').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('添加应用')
    expect((inputByValue(wrapper, 'qwenpaw 副本').element as HTMLInputElement).value).toBe('qwenpaw 副本')
    expect((inputByPlaceholder(wrapper, '~/repo').element as HTMLInputElement).value).toBe('/Users/kriss/qwenpaw')
    expect((inputByPlaceholder(wrapper, 'http://localhost:3000').element as HTMLInputElement).value).toBe('http://localhost:3000')

    await buttonContaining(wrapper, '添加', true).trigger('click')
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'web-1', name: 'qwenpaw', order: 0 },
      { name: 'qwenpaw 副本', workingDirectory: '/Users/kriss/qwenpaw', url: 'http://localhost:3000', order: 1 },
    ])
  })

  it('creates parameter profiles from the run dialog and launches with selected values', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp] },
    })

    await buttonContaining(wrapper, 'qwenpaw').trigger('click')
    await inputByPlaceholder(wrapper, 'npm run dev').setValue('pnpm dev {account= : 账号} {--headless}')
    await buttonContaining(wrapper, '保存', true).trigger('click')
    await flushPromises()

    await buttonContaining(wrapper, '启动', true).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('运行参数')

    await inputByPlaceholder(wrapper, '账号').setValue('demo')
    const headlessSwitch = document.querySelector('[role="switch"]')
    expect(headlessSwitch).toBeTruthy()
    await new DOMWrapper(headlessSwitch as Element).trigger('click')
    await inputByPlaceholder(wrapper, '保存为方案名称').setValue('账号 1')
    await buttonContaining(wrapper, '保存方案', true).trigger('click')
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      {
        id: 'web-1',
        command: 'pnpm dev {account= : 账号} {--headless}',
        activeProfileId: expect.any(String),
        profiles: [
          {
            name: '账号 1',
            values: {
              account: 'demo',
              headless: 'true',
            },
          },
        ],
      },
    ])

    expect(document.body.textContent).toContain('pnpm dev demo --headless')

    await buttonContaining(wrapper, '运行', true).trigger('click')
    await flushPromises()
    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      command: 'pnpm dev demo --headless',
      workingDirectory: '/Users/kriss/qwenpaw',
      url: 'http://localhost:3000',
    })
  })

  it('adds and deletes a scheduled task through the form', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      randomUUID: () => 'new-task',
    })
    const { mock, wrapper } = await mountApp()

    await buttonContaining(wrapper, '任务', true).trigger('click')
    await flushPromises()
    await inputByPlaceholder(wrapper, 'pnpm report').setValue('pnpm report')
    await inputByPlaceholder(wrapper, '~/repo').setValue('/Users/kriss/reports')
    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()
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
      { id: 'new-task', name: 'pnpm report', type: 'task', workingDirectory: '/Users/kriss/reports', schedule: { cron: '*/10 * * * *', missedPolicy: 'run-once' } },
    ])
    expect(document.body.textContent).toContain('已添加')

    await buttonContaining(wrapper, '删除').trigger('click')
    await flushPromises()
    expect(mock.storeData.apps).toEqual([])
  })

  it('drives settings dialog actions from the UI', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp], hide_dock_on_close: false },
      dialogSavePath: '/tmp/apps.json',
      dialogOpenPath: '/tmp/import.json',
      files: { '/tmp/import.json': JSON.stringify([{ ...serviceApp, id: 'imported-worker' }]) },
    })

    await buttonContaining(wrapper, '设置').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('开机自启动')
    expect(document.body.textContent).toContain('菜单栏模式')

    const switches = Array.from(document.querySelectorAll('[role="switch"]')).map((item) => new DOMWrapper(item as HTMLElement))
    await switches[0].trigger('click')
    await switches[1].trigger('click')
    const themeButton = document.querySelector('button[aria-label="切换主题"]')
    if (!themeButton) throw new Error('Theme button not found')
    await new DOMWrapper(themeButton as HTMLElement).trigger('click')
    await buttonContaining(wrapper, '导出').trigger('click')
    await buttonContaining(wrapper, '导入').trigger('click')
    await flushPromises()

    expect(mock.getCalls('plugin:autostart|enable')).toHaveLength(1)
    expect(mock.storeData.hide_dock_on_close).toBe(true)
    expect(mock.getCalls('plugin:fs|write_file')).toHaveLength(1)
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)
    expect(document.body.textContent).toContain('已导入 1 个应用')

    const settingsOverlay = Array.from(document.querySelectorAll('.fixed.inset-0')).find((item) => item.textContent?.includes('开机自启动'))
    if (!settingsOverlay) throw new Error('Settings overlay not found')
    await new DOMWrapper(settingsOverlay as HTMLElement).trigger('click')
    expect(document.body.textContent).not.toContain('开机自启动')
  })

  it('saves web dimensions through numeric fields', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      randomUUID: () => 'new-web',
    })
    const { mock, wrapper } = await mountApp()

    await inputByPlaceholder(wrapper, 'http://localhost:3000').setValue('http://localhost:8080')
    await inputByPlaceholder(wrapper, '~/repo').setValue('/Users/kriss/docs')
    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[0].setValue('1440')
    await numberInputs[1].setValue('900')
    await buttonContaining(wrapper, '添加', true).trigger('click')
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'new-web', name: 'http://localhost:8080', workingDirectory: '/Users/kriss/docs', width: 1440, height: 900 },
    ])
  })

  it('renders remaining run statuses, dismisses notifications, and returns to the add form', async () => {
    const { wrapper } = await mountApp({
      store: {
        apps: [
          { ...serviceApp, id: 'killed', name: 'Killed Job' },
          { ...serviceApp, id: 'lost', name: 'Lost Job' },
          { ...serviceApp, id: 'running-history', name: 'Historical Run' },
        ],
      },
      recentRuns: [
        { id: 'killed-run', app_id: 'killed', app_name: 'Killed Job', item_type: 'service', status: 'killed', pid: null, exit_code: null, started_at: 10, finished_at: 11, log_path: '', trigger: 'manual' },
        { id: 'lost-run', app_id: 'lost', app_name: 'Lost Job', item_type: 'service', status: 'lost', pid: null, exit_code: null, started_at: 12, finished_at: 13, log_path: '', trigger: 'startup-recover' },
        { id: 'running-run', app_id: 'running-history', app_name: 'Historical Run', item_type: 'service', status: 'running', pid: 777, exit_code: null, started_at: 14, finished_at: null, log_path: '', trigger: 'manual' },
      ],
    })

    await buttonContaining(wrapper, 'Killed Job').trigger('click')
    expect(detailPanel(wrapper).text()).toContain('Killed Job')
    expect(detailPanel(wrapper).text()).toContain('已停止')

    await buttonContaining(wrapper, 'Lost Job').trigger('click')
    expect(detailPanel(wrapper).text()).toContain('Lost Job')
    expect(detailPanel(wrapper).text()).toContain('状态丢失')

    await buttonContaining(wrapper, 'Historical Run').trigger('click')
    expect(detailPanel(wrapper).text()).toContain('Historical Run')
    expect(detailPanel(wrapper).text()).toContain('运行中')

    await buttonContaining(wrapper, '添加应用').trigger('click')
    expect(detailPanel(wrapper).text()).toContain('添加应用')
    expect(inputByPlaceholder(wrapper, '默认使用启动命令或 URL').exists()).toBe(true)

    await buttonContaining(wrapper, '添加', true).trigger('click')
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('请填写目标 URL')
    const closeNotice = document.querySelector('button[aria-label="关闭通知"]')
    if (!closeNotice) throw new Error('Close notification button not found')
    await new DOMWrapper(closeNotice as HTMLElement).trigger('click')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
