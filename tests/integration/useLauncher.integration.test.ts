import { emit } from '@tauri-apps/api/event'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLauncher } from '@/composables/useLauncher'
import type { AppItem } from '@/lib/store'
import { setupTauriMocks } from '../helpers/tauri'

const qwenpaw: AppItem = {
  id: 'qwenpaw-id',
  name: 'qwenpaw',
  type: 'web',
  command: 'pnpm dev',
  workingDirectory: '/Users/kriss/project',
  url: 'http://localhost:3000',
  width: 1200,
  height: 800,
  schedule: {
    enabled: false,
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    missedPolicy: 'skip',
  },
}

async function mountLauncher(options: Parameters<typeof setupTauriMocks>[0] = {}) {
  const mock = setupTauriMocks(options)
  const apps = ref<AppItem[]>([qwenpaw])
  const showMessage = vi.fn()
  const openLogDialog = vi.fn()
  let launcher!: ReturnType<typeof useLauncher>

  const wrapper = mount(defineComponent({
    setup() {
      launcher = useLauncher(apps, showMessage, openLogDialog)
      return () => h('div')
    },
  }))
  await flushPromises()

  return { launcher, mock, openLogDialog, showMessage, wrapper }
}

describe('useLauncher integration', () => {
  it('loads latest run history sorted by newest run per app', async () => {
    const { launcher, wrapper } = await mountLauncher({
      runningApps: [{ app_id: 'qwenpaw-id', pid: null, item_type: 'web' }],
      recentRuns: [
        {
          id: 'old',
          app_id: 'qwenpaw-id',
          app_name: 'qwenpaw',
          item_type: 'web',
          status: 'failed',
          pid: null,
          exit_code: 1,
          started_at: 100,
          finished_at: 110,
          log_path: '',
          trigger: 'manual',
        },
        {
          id: 'new',
          app_id: 'qwenpaw-id',
          app_name: 'qwenpaw',
          item_type: 'web',
          status: 'success',
          pid: null,
          exit_code: 0,
          started_at: 200,
          finished_at: 210,
          log_path: '',
          trigger: 'schedule',
        },
      ],
    })

    await launcher.refreshRunningApps()

    expect(launcher.runningAppIds.value.has('qwenpaw-id')).toBe(true)
    expect(launcher.runningPids.value.size).toBe(0)
    expect(launcher.latestRuns.value.get('qwenpaw-id')?.id).toBe('new')
    wrapper.unmount()
  })

  it('keeps running state even when recent run history cannot be loaded', async () => {
    const { launcher, wrapper } = await mountLauncher({
      runningApps: [{ app_id: 'qwenpaw-id', pid: 4321, item_type: 'web' }],
      rejectCommands: { get_recent_runs: new Error('store unavailable') },
    })

    await launcher.refreshRunningApps()

    expect(launcher.runningAppIds.value.has('qwenpaw-id')).toBe(true)
    expect(launcher.runningPids.value.get('qwenpaw-id')).toBe(4321)
    wrapper.unmount()
  })

  it('opens the matching app log from tray events', async () => {
    const { openLogDialog, wrapper } = await mountLauncher()

    await emit('tray-open-log', 'qwenpaw-id')
    await emit('tray-open-log', 'missing-id')
    await flushPromises()

    expect(openLogDialog).toHaveBeenCalledWith(qwenpaw)
    wrapper.unmount()
  })

  it('launches apps, captures background color, opens logs for command apps, and handles no-command windows', async () => {
    document.body.style.backgroundColor = 'rgb(10, 20, 30)'
    const { launcher, openLogDialog, showMessage, wrapper } = await mountLauncher({
      launchResult: { message: '窗口已打开', pid: null, run_id: null },
    })
    const noCommand = { ...qwenpaw, command: '' }

    await launcher.launchApp(noCommand)

    expect(showMessage).toHaveBeenCalledWith('窗口已打开', 'success')
    expect(openLogDialog).not.toHaveBeenCalled()
    expect(launcher.loading.value).toBe(false)

    wrapper.unmount()

    const commandCase = await mountLauncher({
      launchResult: { message: '任务已启动', pid: 2468, run_id: 'run-2' },
    })
    await commandCase.launcher.launchApp(qwenpaw)

    expect(commandCase.openLogDialog).toHaveBeenCalledWith(qwenpaw)
    expect(commandCase.launcher.loading.value).toBe(false)
    commandCase.wrapper.unmount()

    const commandWithoutPid = await mountLauncher({
      launchResult: { message: '任务正在运行', pid: null, run_id: null },
    })
    await commandWithoutPid.launcher.launchApp(qwenpaw)
    expect(commandWithoutPid.showMessage).toHaveBeenCalledWith('任务正在运行', 'success')
    expect(commandWithoutPid.openLogDialog).toHaveBeenCalledWith(qwenpaw)
    commandWithoutPid.wrapper.unmount()

    const fallback = await mountLauncher({
      launchResult: { message: '窗口已打开', pid: null, run_id: null },
    })
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'not-a-color',
    } as CSSStyleDeclaration)
    await fallback.launcher.launchApp({ ...qwenpaw, command: '' })
    expect(fallback.showMessage.mock.calls.length).toBeGreaterThan(0)
    expect(fallback.mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      workingDirectory: '/Users/kriss/project',
      bgR: 255,
      bgG: 255,
      bgB: 255,
    })
    expect(fallback.launcher.loading.value).toBe(false)
    styleSpy.mockRestore()
    fallback.wrapper.unmount()
  })

  it('reports launch and stop failures', async () => {
    const { launcher, showMessage, wrapper } = await mountLauncher({
      rejectCommands: {
        launch_app_window: new Error('boom'),
        stop_app: new Error('cannot stop'),
      },
    })

    await launcher.launchApp(qwenpaw)
    await launcher.stopApp('qwenpaw-id')
    await expect(launcher.showAppWindow('qwenpaw-id')).resolves.toBeUndefined()

    expect(showMessage).toHaveBeenCalledWith('启动失败: boom', 'error')
    expect(showMessage).toHaveBeenCalledWith('停止失败: cannot stop', 'error')
    expect(launcher.loading.value).toBe(false)
    wrapper.unmount()
  })

  it('reacts to process lifecycle and tray launch events', async () => {
    const runningApps = [{ app_id: 'qwenpaw-id', pid: 4321, item_type: 'web' as const }]
    const { launcher, openLogDialog, wrapper } = await mountLauncher({
      runningApps,
    })

    await emit('app-launched', 'qwenpaw-id')
    await flushPromises()
    expect(launcher.runningAppIds.value.has('qwenpaw-id')).toBe(true)

    runningApps.length = 0
    await emit('app-process-stopped', 'qwenpaw-id')
    await flushPromises()
    expect(launcher.runningPids.value.has('qwenpaw-id')).toBe(false)

    await emit('app-stopped', 'qwenpaw-id')
    await flushPromises()
    expect(launcher.runningAppIds.value.has('qwenpaw-id')).toBe(false)

    await emit('app-run-updated', { app_id: 'qwenpaw-id' })
    await emit('tray-launch-app', 'qwenpaw-id')
    await flushPromises()
    expect(openLogDialog).toHaveBeenCalledWith(qwenpaw)

    wrapper.unmount()
  })
})
