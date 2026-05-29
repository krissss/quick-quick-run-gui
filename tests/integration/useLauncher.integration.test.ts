import { emit } from '@tauri-apps/api/event'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { normalizeApp, type AppItem } from '@/lib/store'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import { useMessageStore } from '@/stores/message'
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
  setActivePinia(createPinia())
  const apps = useAppsStore()
  const launcher = useLauncherStore()
  const logs = useLogsStore()
  const message = useMessageStore()
  apps.apps = initialApps
  await launcher.startEventListeners()
  const launcherRefs = storeToRefs(launcher)
  const messageRefs = storeToRefs(message)
  return { apps, launcher, logs, mock, ...launcherRefs, ...messageRefs }
}

describe('launcher store', () => {
  it('loads recent run history sorted while keeping the newest run per app', async () => {
    const { launcher, runningAppIds, runningPids, latestRuns, recentRuns } = await mountLauncher({
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
          command: 'pnpm dev --old',
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
          command: 'pnpm dev --new',
          log_path: '',
          trigger: 'schedule',
        },
      ],
    })

    await launcher.refreshRunningApps()

    expect(runningAppIds.value.has('demo-web-id')).toBe(true)
    expect(runningPids.value.size).toBe(0)
    expect(recentRuns.value.map(run => run.id)).toEqual(['new', 'old'])
    expect(latestRuns.value.get('demo-web-id')?.id).toBe('new')
  })

  it('refreshes runtime state without blocking on reconcile', async () => {
    const { launcher, runningAppIds, latestRuns } = await mountLauncher({
      runningApps: [{ app_id: 'demo-web-id', pid: 4321, item_type: 'web' }],
      recentRuns: [
        {
          id: 'run-active',
          app_id: 'demo-web-id',
          app_name: 'demo-web',
          item_type: 'web',
          status: 'running',
          pid: 4321,
          exit_code: null,
          started_at: 300,
          finished_at: null,
          command: 'pnpm dev',
          log_path: '/tmp/run-active.log',
          trigger: 'manual',
        },
      ],
      rejectCommands: {
        reconcile_running_records: new Error('reconcile unavailable'),
      },
    })

    await launcher.refreshRunningApps()

    expect(runningAppIds.value.has('demo-web-id')).toBe(true)
    expect(latestRuns.value.get('demo-web-id')?.id).toBe('run-active')
  })

  it('only runs reconcile when explicitly requested by refresh', async () => {
    const { launcher, mock } = await mountLauncher({
      runningApps: [{ app_id: 'demo-web-id', pid: 4321, item_type: 'web' }],
    })

    await launcher.refreshRunningApps()
    expect(mock.getCalls('reconcile_running_records')).toHaveLength(0)

    await launcher.refreshRunningApps({ reconcile: true })
    expect(mock.getCalls('reconcile_running_records')).toHaveLength(1)
  })

  it('relaunches the exact command captured on a run record', async () => {
    const { launcher, mock } = await mountLauncher()

    await launcher.relaunchRunCommand({
      id: 'run-history',
      app_id: 'demo-web-id',
      app_name: 'demo-web',
      item_type: 'web',
      status: 'success',
      pid: null,
      exit_code: 0,
      started_at: 200,
      finished_at: 210,
      command: 'pnpm dev --history',
      log_path: '',
      trigger: 'manual',
    })

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'demo-web-id',
      command: 'pnpm dev --history',
      launchTrigger: 'manual',
      openWindow: true,
    })
  })

  it('finds apps from the apps store for tray events', async () => {
    await mountLauncher()
    const launcher = useLauncherStore()

    expect(launcher.findApp('demo-web-id')).toMatchObject({ id: 'demo-web-id', name: 'demo-web' })
    expect(launcher.findApp('missing-id')).toBeNull()
  })

  it('focuses an already running web app instead of launching it again', async () => {
    const { launcher, mock, logs, messages, loading } = await mountLauncher({
      runningApps: [{ app_id: 'demo-web-id', pid: 4321, item_type: 'web' }],
    })

    await launcher.refreshRunningApps()
    await launcher.launchApp(demoWeb)

    expect(mock.getCalls('launch_app_window')).toHaveLength(0)
    expect(mock.getCalls('show_app_window').at(-1)?.payload).toEqual({ appId: 'demo-web-id' })
    expect(logs.showLogDialog).toBe(false)
    expect(loading.value).toBe(false)
    expect(messages.value.at(-1)?.text).toBe('demo-web 正在运行，已打开窗口')
  })

  it('launches services without a full reconcile so startup stays responsive', async () => {
    const { launcher, mock } = await mountLauncher({
      launchResult: { message: '服务已启动', pid: 1234, run_id: 'run-service' },
    })
    const service = normalizeApp({
      ...demoWeb,
      id: 'demo-service-id',
      name: 'demo-service',
      type: 'service',
      command: 'php start.php start',
      url: '',
    })

    await launcher.launchApp(service)

    expect(mock.getCalls('reconcile_running_records')).toHaveLength(0)
    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'demo-service-id',
      launchTrigger: 'manual',
    })
  })

  it('does not reconcile startup launches so app startup stays responsive', async () => {
    const { launcher, mock } = await mountLauncher({
      launchResult: { message: '服务已启动', pid: 1234, run_id: 'run-service' },
    })
    const service = normalizeApp({
      ...demoWeb,
      id: 'demo-service-id',
      name: 'demo-service',
      type: 'service',
      command: 'php start.php start',
      url: '',
    })

    await launcher.launchApp(service, { trigger: 'startup' })

    expect(mock.getCalls('reconcile_running_records')).toHaveLength(0)
    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'demo-service-id',
      launchTrigger: 'startup',
    })
  })

  it('starts web startup commands without opening their windows', async () => {
    const { launcher, mock, messages } = await mountLauncher({
      launchResult: { message: '应用正在运行，已保留后台进程', pid: null, run_id: 'run-web' },
    })

    await launcher.launchApp(demoWeb, { trigger: 'startup' })

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'demo-web-id',
      launchTrigger: 'startup',
      openWindow: false,
    })
    expect(messages.value).toHaveLength(0)
  })

  it('refreshes after the backend finishes background reconciliation', async () => {
    const { runningAppIds, mock } = await mountLauncher({
      runningApps: [{ app_id: 'demo-web-id', pid: 4321, item_type: 'web' }],
    })

    await emit('running-records-reconciled', null)
    await flushPromises()

    expect(runningAppIds.value.has('demo-web-id')).toBe(true)
    expect(mock.getCalls('get_running_apps').length).toBeGreaterThan(0)
  })

  it('explains when stopping a web window has no bound backend process', async () => {
    const { messages } = await mountLauncher()

    await emit('app-run-unbound', { app_id: 'demo-web-id', run_id: 'run-web' })
    await flushPromises()

    expect(messages.value.at(-1)?.text).toBe('demo-web 已关闭窗口，后台进程尚未绑定，未停止服务')
  })

  it('launches apps, captures background color, and handles no-command windows', async () => {
    document.body.style.backgroundColor = 'rgb(10, 20, 30)'
    const { launcher, mock, messages, loading } = await mountLauncher({
      launchResult: { message: '窗口已打开', pid: null, run_id: null },
    })
    const noCommand = { ...demoWeb, command: '' }

    await launcher.launchApp(noCommand)

    expect(messages.value.at(-1)?.text).toBe('窗口已打开')
    expect(loading.value).toBe(false)

    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'not-a-color',
    } as CSSStyleDeclaration)
    await launcher.launchApp({ ...demoWeb, id: 'demo-web-fallback-id', command: '' })
    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      workingDirectory: '/Users/demo/project',
      launchTrigger: 'manual',
      bgR: 255,
      bgG: 255,
      bgB: 255,
    })
    styleSpy.mockRestore()
  })

  it('schedules and cancels delayed manual launches in the current app session', async () => {
    const mock = setupTauriMocks()
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const appsStore = useAppsStore()
    appsStore.apps = [demoWeb]
    const launcher = useLauncherStore()
    await launcher.startEventListeners()
    const { pendingLaunches } = storeToRefs(launcher)
    const { messages } = storeToRefs(useMessageStore())

    await launcher.launchApp(demoWeb, { delaySeconds: 1 })

    expect(mock.getCalls('launch_app_window')).toHaveLength(0)
    expect(pendingLaunches.value.get('demo-web-id')).toMatchObject({
      appId: 'demo-web-id',
      delaySeconds: 1,
    })
    expect(messages.value.at(-1)?.text).toContain('已安排 demo-web')

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window').at(-1)?.payload).toMatchObject({
      appId: 'demo-web-id',
      launchTrigger: 'delayed',
    })
    expect(pendingLaunches.value.has('demo-web-id')).toBe(false)

    await launcher.launchApp(demoWeb, { delaySeconds: 10 })
    launcher.cancelDelayedLaunch('demo-web-id')
    await vi.advanceTimersByTimeAsync(10000)
    await flushPromises()

    expect(mock.getCalls('launch_app_window')).toHaveLength(1)
    vi.useRealTimers()
  })
})
