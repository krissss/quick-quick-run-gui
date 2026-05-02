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
  url: 'http://localhost:3000',
  width: 1200,
  height: 800,
  schedule: baseSchedule,
}

const serviceApp: AppItem = {
  id: 'service-1',
  name: 'worker',
  type: 'service',
  command: 'pnpm worker',
  url: '',
  width: 1200,
  height: 800,
  schedule: baseSchedule,
}

const taskApp: AppItem = {
  id: 'task-1',
  name: 'daily',
  type: 'task',
  command: 'pnpm daily',
  url: '',
  width: 1200,
  height: 800,
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
  if (!input) throw new Error(`Input not found: ${placeholder}`)
  return input
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

  it('adds and deletes a scheduled task through the form', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      randomUUID: () => 'new-task',
    })
    const { mock, wrapper } = await mountApp()

    await buttonContaining(wrapper, '任务', true).trigger('click')
    await flushPromises()
    await inputByPlaceholder(wrapper, '例如：同步日报').setValue('同步日报')
    await inputByPlaceholder(wrapper, 'cd ~/repo && pnpm report').setValue('pnpm report')
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
      { id: 'new-task', name: '同步日报', type: 'task', schedule: { cron: '*/10 * * * *', missedPolicy: 'run-once' } },
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

    await inputByPlaceholder(wrapper, '例如：我的博客').setValue('Docs')
    await inputByPlaceholder(wrapper, 'http://localhost:3000').setValue('http://localhost:8080')
    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[0].setValue('1440')
    await numberInputs[1].setValue('900')
    await buttonContaining(wrapper, '添加', true).trigger('click')
    await flushPromises()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'new-web', width: 1440, height: 900 },
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
    expect(inputByPlaceholder(wrapper, '例如：我的博客').exists()).toBe(true)

    await buttonContaining(wrapper, '添加', true).trigger('click')
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('请填写名称')
    const closeNotice = document.querySelector('button[aria-label="关闭通知"]')
    if (!closeNotice) throw new Error('Close notification button not found')
    await new DOMWrapper(closeNotice as HTMLElement).trigger('click')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
