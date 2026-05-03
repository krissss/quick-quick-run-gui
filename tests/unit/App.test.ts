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

function detailPanel(wrapper: ReturnType<typeof mount>) {
  const panel = wrapper.find('.max-w-md')
  if (!panel.exists()) throw new Error('Detail panel not found')
  return panel
}

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('wires restored apps to launcher, log dialog, and running controls', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp, serviceApp, taskApp] },
      logs: { 'web-1': ['ready'] },
      runningApps: [{ app_id: 'web-1', pid: 4321, item_type: 'web' }],
      recentRuns: [serviceFailedRun, taskSuccessRun],
    })

    await buttonContaining(wrapper, 'qwenpaw').trigger('click')
    expect(detailPanel(wrapper).text()).toContain('PID 4321')

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
    await buttonContaining(wrapper, '重新启动').trigger('click')
    expect(mock.getCalls('launch_app_window')).toHaveLength(1)
  })

  it('duplicates the current app and persists the copied template', async () => {
    const { mock, wrapper } = await mountApp({
      store: { apps: [webApp] },
    })

    await buttonContaining(wrapper, 'qwenpaw').trigger('click')
    await buttonContaining(wrapper, '复制').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('添加应用')
    expect((inputByValue(wrapper, 'qwenpaw 副本').element as HTMLInputElement).value).toBe('qwenpaw 副本')
    expect((inputByPlaceholder(wrapper, '~/repo').element as HTMLInputElement).value).toBe('/Users/kriss/qwenpaw')

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
    await inputByPlaceholder(wrapper, 'pnpm report').setValue('pnpm report')
    await inputByPlaceholder(wrapper, '~/repo').setValue('/Users/kriss/reports')
    await wrapper.get('[role="switch"]').trigger('click')
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

    await buttonContaining(wrapper, '删除').trigger('click')
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
    await switches[0].trigger('click')
    await switches[1].trigger('click')
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
