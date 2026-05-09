import { emit } from '@tauri-apps/api/event'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLauncher } from '@/composables/useLauncher'
import { normalizeApp, type AppItem } from '@/lib/store'
import { serviceApp, taskApp } from '../fixtures/apps'
import { setupTauriMocks } from '../helpers/tauri'

const demoWeb: AppItem = normalizeApp({
  id: 'demo-web-id',
  name: 'demo-web',
  type: 'web',
  command: 'pnpm dev',
  workingDirectory: '/Users/demo/project',
  url: 'http://localhost:3000',
  width: 1200,
  height: 800,
  profiles: [],
  activeProfileId: '',
  schedule: {
    enabled: false,
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    missedPolicy: 'skip',
  },
})

async function mountLauncher(options: Parameters<typeof setupTauriMocks>[0] = {}, initialApps: AppItem[] = [demoWeb]) {
  const mock = setupTauriMocks(options)
  const apps = ref<AppItem[]>(initialApps)
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

  return { apps, launcher, mock, openLogDialog, showMessage, wrapper }
}

describe('useLauncher integration', () => {
  it('loads latest run history sorted by newest run per app', async () => {
    const { launcher, wrapper } = await mountLauncher({
      runningApps: [{ app_id: 'demo-web-id', pid: null, item_type: 'web' }],
      recentRuns: [
        {
          id: 'old',
          app_id: 'demo-web-id',
          app_name: 'demo-web',
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
          app_id: 'demo-web-id',
          app_name: 'demo-web',
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

    expect(launcher.runningAppIds.value.has('demo-web-id')).toBe(true)
    expect(launcher.runningPids.value.size).toBe(0)
    expect(launcher.latestRuns.value.get('demo-web-id')?.id).toBe('new')
    wrapper.unmount()
  })

  it('keeps running state even when recent run history cannot be loaded', async () => {
    const { launcher, wrapper } = await mountLauncher({
      runningApps: [{ app_id: 'demo-web-id', pid: 4321, item_type: 'web' }],
      rejectCommands: { get_recent_runs: new Error('store unavailable') },
    })

    await launcher.refreshRunningApps()

    expect(launcher.runningAppIds.value.has('demo-web-id')).toBe(true)
    expect(launcher.runningPids.value.get('demo-web-id')).toBe(4321)
    wrapper.unmount()
  })

  it('opens the matching app log from tray events', async () => {
    const { openLogDialog, wrapper } = await mountLauncher()

    await emit('tray-open-log', 'demo-web-id')
    await emit('tray-open-log', 'missing-id')
    await flushPromises()

    expect(openLogDialog).toHaveBeenCalledWith(demoWeb)
    wrapper.unmount()
  })

  it('launches apps, captures background color, opens logs for command apps, and handles no-command windows', async () => {
    document.body.style.backgroundColor = 'rgb(10, 20, 30)'
    const { launcher, openLogDialog, showMessage, wrapper } = await mountLauncher({
      launchResult: { message: '窗口已打开', pid: null, run_id: null },
    })
    const noCommand = { ...demoWeb, command: '' }

    await launcher.launchApp(noCommand)

    expect(showMessage).toHaveBeenCalledWith('窗口已打开', 'success')
    expect(openLogDialog).not.toHaveBeenCalled()
    expect(launcher.loading.value).toBe(false)

    wrapper.unmount()

    const commandCase = await mountLauncher({
      launchResult: { message: '任务已启动', pid: 2468, run_id: 'run-2' },
    })
    await commandCase.launcher.launchApp(demoWeb)

    expect(commandCase.openLogDialog).toHaveBeenCalledWith(demoWeb)
    expect(commandCase.launcher.loading.value).toBe(false)
    commandCase.wrapper.unmount()

    const commandWithoutPid = await mountLauncher({
      launchResult: { message: '任务正在运行', pid: null, run_id: null },
    })
    await commandWithoutPid.launcher.launchApp(demoWeb)
    expect(commandWithoutPid.showMessage).toHaveBeenCalledWith('任务正在运行', 'success')
    expect(commandWithoutPid.openLogDialog).toHaveBeenCalledWith(demoWeb)
    commandWithoutPid.wrapper.unmount()

    const fallback = await mountLauncher({
      launchResult: { message: '窗口已打开', pid: null, run_id: null },
    })
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'not-a-color',
    } as CSSStyleDeclaration)
    await fallback.launcher.launchApp({ ...demoWeb, command: '' })
    expect(fallback.showMessage.mock.calls.length).toBeGreaterThan(0)
    expect(fallback.mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      workingDirectory: '/Users/demo/project',
      launchTrigger: 'manual',
      bgR: 255,
      bgG: 255,
      bgB: 255,
    })
    expect(fallback.launcher.loading.value).toBe(false)
    styleSpy.mockRestore()
    fallback.wrapper.unmount()
  })

  it('resolves the active profile before launching', async () => {
    const { launcher, mock, openLogDialog, wrapper } = await mountLauncher()
    const profiledApp: AppItem = {
      ...demoWeb,
      command: 'pnpm dev {account= : 账号} {--headless}',
      activeProfileId: 'profile-1',
      profiles: [
        {
          id: 'profile-1',
          name: '账号 1',
          values: {
            account: 'demo',
            headless: 'true',
          },
        },
      ],
    }

    await launcher.launchApp(profiledApp)

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      command: 'pnpm dev demo --headless',
      workingDirectory: '/Users/demo/project',
      url: 'http://localhost:3000',
    })
    expect(openLogDialog).toHaveBeenCalledWith(expect.objectContaining({
      id: 'demo-web-id',
      command: 'pnpm dev demo --headless',
      workingDirectory: '/Users/demo/project',
    }))
    wrapper.unmount()
  })

  it('schedules and cancels delayed manual launches in the current app session', async () => {
    vi.useFakeTimers()
    const { launcher, mock, openLogDialog, showMessage, wrapper } = await mountLauncher()

    await launcher.launchApp(demoWeb, { delaySeconds: 1 })

    expect(mock.getCalls('launch_app_window')).toHaveLength(0)
    expect(launcher.pendingLaunches.value.get('demo-web-id')).toMatchObject({
      appId: 'demo-web-id',
      delaySeconds: 1,
    })
    expect(showMessage.mock.calls.at(-1)?.[0]).toContain('已安排 demo-web')

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'demo-web-id',
      launchTrigger: 'delayed',
    })
    expect(openLogDialog).not.toHaveBeenCalled()
    expect(launcher.pendingLaunches.value.has('demo-web-id')).toBe(false)

    await launcher.launchApp(demoWeb, { delaySeconds: 10 })
    launcher.cancelDelayedLaunch('demo-web-id')
    await vi.advanceTimersByTimeAsync(10000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window')).toHaveLength(1)
    expect(showMessage.mock.calls.at(-1)).toEqual(['已取消延迟运行：demo-web', 'info'])

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('reports launch and stop failures', async () => {
    const { launcher, showMessage, wrapper } = await mountLauncher({
      rejectCommands: {
        launch_app_window: new Error('boom'),
        stop_app: new Error('cannot stop'),
      },
    })

    await launcher.launchApp(demoWeb)
    await launcher.stopApp('demo-web-id')
    await expect(launcher.showAppWindow('demo-web-id')).resolves.toBeUndefined()

    expect(showMessage).toHaveBeenCalledWith('启动失败: boom', 'error')
    expect(showMessage).toHaveBeenCalledWith('停止失败: cannot stop', 'error')
    expect(launcher.loading.value).toBe(false)
    wrapper.unmount()
  })

  it('automatically restarts failed services within the configured attempt limit', async () => {
    vi.useFakeTimers()
    const service = normalizeApp({
      ...serviceApp,
      restart: { enabled: true, mode: 'on-failure', maxAttempts: 2, delaySeconds: 1 },
    })
    const { launcher, mock, openLogDialog, wrapper } = await mountLauncher({}, [service])

    await emit('app-run-updated', { app_id: service.id, run_id: 'run-1', status: 'failed' })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: service.id,
      itemType: 'service',
      launchTrigger: 'auto-restart',
    })
    expect(openLogDialog).not.toHaveBeenCalled()
    expect(launcher.loading.value).toBe(false)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not restart deleted services after the configured delay', async () => {
    vi.useFakeTimers()
    const service = normalizeApp({
      ...serviceApp,
      restart: { enabled: true, mode: 'on-failure', maxAttempts: 2, delaySeconds: 1 },
    })
    const { apps, mock, wrapper } = await mountLauncher({}, [service])

    await emit('app-run-updated', { app_id: service.id, run_id: 'run-1', status: 'failed' })
    await flushPromises()
    apps.value = []
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window')).toHaveLength(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not restart services when restart is disabled before the delay finishes', async () => {
    vi.useFakeTimers()
    const service = normalizeApp({
      ...serviceApp,
      restart: { enabled: true, mode: 'on-failure', maxAttempts: 2, delaySeconds: 1 },
    })
    const { apps, mock, wrapper } = await mountLauncher({}, [service])

    await emit('app-run-updated', { app_id: service.id, run_id: 'run-1', status: 'failed' })
    await flushPromises()
    apps.value = [
      normalizeApp({
        ...service,
        restart: { ...service.restart, enabled: false },
      }),
    ]
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window')).toHaveLength(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('automatically retries failed tasks', async () => {
    vi.useFakeTimers()
    const task = normalizeApp({
      ...taskApp,
      retry: { enabled: true, maxAttempts: 2, delaySeconds: 1 },
    })
    const { launcher, mock, openLogDialog, wrapper } = await mountLauncher({}, [task])

    await emit('app-run-updated', { app_id: task.id, run_id: 'run-1', status: 'failed' })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: task.id,
      itemType: 'task',
      launchTrigger: 'retry',
    })
    expect(openLogDialog).not.toHaveBeenCalled()
    expect(launcher.loading.value).toBe(false)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not retry tasks when retry is disabled before the delay finishes', async () => {
    vi.useFakeTimers()
    const task = normalizeApp({
      ...taskApp,
      retry: { enabled: true, maxAttempts: 2, delaySeconds: 1 },
    })
    const { apps, mock, wrapper } = await mountLauncher({}, [task])

    await emit('app-run-updated', { app_id: task.id, run_id: 'run-1', status: 'failed' })
    await flushPromises()
    apps.value = [
      normalizeApp({
        ...task,
        retry: { ...task.retry, enabled: false },
      }),
    ]
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window')).toHaveLength(0)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('reacts to process lifecycle and tray launch events', async () => {
    const runningApps = [{ app_id: 'demo-web-id', pid: 4321, item_type: 'web' as const }]
    const { launcher, openLogDialog, wrapper } = await mountLauncher({
      runningApps,
    })

    await emit('app-launched', 'demo-web-id')
    await flushPromises()
    expect(launcher.runningAppIds.value.has('demo-web-id')).toBe(true)

    runningApps.length = 0
    await emit('app-process-stopped', 'demo-web-id')
    await flushPromises()
    expect(launcher.runningPids.value.has('demo-web-id')).toBe(false)

    await emit('app-stopped', 'demo-web-id')
    await flushPromises()
    expect(launcher.runningAppIds.value.has('demo-web-id')).toBe(false)

    await emit('app-run-updated', { app_id: 'demo-web-id' })
    await emit('tray-launch-app', 'demo-web-id')
    await flushPromises()
    expect(openLogDialog).toHaveBeenCalledWith(demoWeb)

    wrapper.unmount()
  })
})
