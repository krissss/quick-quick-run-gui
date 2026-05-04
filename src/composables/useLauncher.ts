import { ref, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { resolveAppProfile, type AppItem, type AppType } from '@/lib/store'
import { getErrorMessage } from './useMessage'

interface RunningAppInfo {
  app_id: string
  pid: number | null
  item_type: AppType
}

export interface RunRecord {
  id: string
  app_id: string
  app_name: string
  item_type: AppType
  status: 'running' | 'success' | 'failed' | 'killed' | 'lost'
  pid: number | null
  exit_code: number | null
  started_at: number
  finished_at: number | null
  log_path: string
  trigger: LaunchTrigger | 'schedule' | 'startup-recover'
}

export type LaunchTrigger = 'manual' | 'startup' | 'auto-restart' | 'retry'

interface RunUpdatedPayload {
  app_id: string
  run_id: string
  status: RunRecord['status']
}

interface LaunchOptions {
  trigger?: LaunchTrigger
  openLog?: boolean
}

export function useLauncher(
  apps: { value: AppItem[] },
  showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void,
  openLogDialog: (app: AppItem) => void | Promise<void>,
) {
  const loading = ref(false)
  const runningAppIds = ref<Set<string>>(new Set())
  const runningPids = ref<Map<string, number>>(new Map())
  const latestRuns = ref<Map<string, RunRecord>>(new Map())
  const automationAttempts = new Map<string, number>()

  async function refreshRunningApps() {
    try {
      const infos = await invoke<RunningAppInfo[]>('get_running_apps')
      runningAppIds.value = new Set(infos.map(info => info.app_id))
      runningPids.value = new Map(
        infos
          .filter((info): info is RunningAppInfo & { pid: number } => info.pid != null)
          .map(info => [info.app_id, info.pid]),
      )
      const runs = await invoke<RunRecord[]>('get_recent_runs')
      const latest = new Map<string, RunRecord>()
      for (const run of runs.sort((a, b) => b.started_at - a.started_at)) {
        if (!latest.has(run.app_id)) latest.set(run.app_id, run)
      }
      latestRuns.value = latest
    } catch { /* ignore */ }
  }

  function getBackgroundRGB(): [number, number, number] {
    const rgb = getComputedStyle(document.body).backgroundColor
    const m = rgb.match(/\d+/g)
    if (m && m.length >= 3) return [+m[0], +m[1], +m[2]]
    return [255, 255, 255]
  }

  function automationKey(kind: 'restart' | 'retry', appId: string) {
    return `${kind}:${appId}`
  }

  function resetAutomationAttempts(appId: string) {
    automationAttempts.delete(automationKey('restart', appId))
    automationAttempts.delete(automationKey('retry', appId))
  }

  async function launchApp(app: AppItem, options: LaunchOptions = {}) {
    const trigger = options.trigger || 'manual'
    const openLog = options.openLog ?? true
    if (trigger === 'manual') resetAutomationAttempts(app.id)
    loading.value = true
    try {
      const launchTarget = resolveAppProfile(app)
      const [bgR, bgG, bgB] = getBackgroundRGB()
      const result = await invoke<{ message: string; pid: number | null; run_id: string | null }>('launch_app_window', {
        appId: launchTarget.id,
        command: launchTarget.command,
        workingDirectory: launchTarget.workingDirectory,
        url: launchTarget.url,
        width: launchTarget.width,
        height: launchTarget.height,
        appName: launchTarget.name,
        itemType: launchTarget.type || 'web',
        launchTrigger: trigger,
        bgR,
        bgG,
        bgB,
      })
      if (result.pid != null) {
        const m = new Map(runningPids.value)
        m.set(launchTarget.id, result.pid)
        runningPids.value = m
      } else if (!launchTarget.command.trim()) {
        const m = new Map(runningPids.value)
        m.delete(launchTarget.id)
        runningPids.value = m
        showMessage(result.message, 'success')
      } else {
        showMessage(result.message, 'success')
      }
      const s = new Set(runningAppIds.value)
      s.add(launchTarget.id)
      runningAppIds.value = s
      if (openLog && launchTarget.command.trim()) {
        await openLogDialog(launchTarget)
      }
      await refreshRunningApps()
    } catch (e: unknown) {
      showMessage(`启动失败: ${getErrorMessage(e)}`, 'error')
    }
    loading.value = false
  }

  function shouldRestart(app: AppItem, status: RunRecord['status']) {
    if (app.type !== 'service' || !app.restart.enabled) return false
    if (status === 'killed') return false
    if (app.restart.mode === 'always') return ['success', 'failed', 'lost'].includes(status)
    return ['failed', 'lost'].includes(status)
  }

  function shouldRetry(app: AppItem, status: RunRecord['status']) {
    return app.type === 'task'
      && app.retry.enabled
      && ['failed', 'lost'].includes(status)
  }

  function scheduleAutomatedLaunch(
    app: AppItem,
    kind: 'restart' | 'retry',
    trigger: LaunchTrigger,
    maxAttempts: number,
    delaySeconds: number,
  ) {
    const key = automationKey(kind, app.id)
    const nextAttempt = (automationAttempts.get(key) || 0) + 1
    if (nextAttempt > maxAttempts) {
      showMessage(kind === 'restart' ? '重启次数已达上限' : '重试次数已达上限', 'error')
      return
    }
    automationAttempts.set(key, nextAttempt)
    window.setTimeout(async () => {
      await refreshRunningApps()
      const currentApp = apps.value.find(item => item.id === app.id)
      if (!currentApp || runningAppIds.value.has(currentApp.id)) return
      if (kind === 'restart' && !currentApp.restart.enabled) return
      if (kind === 'retry' && !currentApp.retry.enabled) return
      await launchApp(currentApp, { trigger, openLog: false })
    }, Math.max(0, delaySeconds) * 1000)
  }

  async function handleRunUpdated(payload: RunUpdatedPayload) {
    if (payload.status === 'running') return
    const app = apps.value.find(item => item.id === payload.app_id)
    if (!app) return
    if (shouldRestart(app, payload.status)) {
      scheduleAutomatedLaunch(app, 'restart', 'auto-restart', app.restart.maxAttempts, app.restart.delaySeconds)
      return
    }
    if (shouldRetry(app, payload.status)) {
      scheduleAutomatedLaunch(app, 'retry', 'retry', app.retry.maxAttempts, app.retry.delaySeconds)
      return
    }
    if (payload.status === 'success' || payload.status === 'killed') {
      resetAutomationAttempts(app.id)
    }
  }

  // 事件监听
  const unlisteners: (() => void)[] = []

  onMounted(async () => {
    unlisteners.push(
      await listen<string>('app-launched', (e) => {
        const s = new Set(runningAppIds.value)
        s.add(e.payload)
        runningAppIds.value = s
        refreshRunningApps()
      }),
      await listen<string>('app-stopped', (e) => {
        const s = new Set(runningAppIds.value)
        s.delete(e.payload)
        runningAppIds.value = s
        const m = new Map(runningPids.value)
        m.delete(e.payload)
        runningPids.value = m
        refreshRunningApps()
      }),
      await listen<string>('app-process-stopped', (e) => {
        const m = new Map(runningPids.value)
        m.delete(e.payload)
        runningPids.value = m
        refreshRunningApps()
      }),
      await listen<RunUpdatedPayload>('app-run-updated', async (e) => {
        await refreshRunningApps()
        await handleRunUpdated(e.payload)
      }),
      await listen<string>('app-logs-cleared', () => {
        refreshRunningApps()
      }),
      await listen<string>('tray-launch-app', async (e) => {
        const app = apps.value.find(a => a.id === e.payload)
        if (app) await launchApp(app)
      }),
      await listen<string>('tray-open-log', async (e) => {
        const app = apps.value.find(a => a.id === e.payload)
        if (app) await openLogDialog(app)
      }),
    )
  })

  onUnmounted(() => {
    unlisteners.forEach(fn => fn())
  })

  async function stopApp(appId: string) {
    try {
      await invoke('stop_app', { appId })
    } catch (e: unknown) {
      showMessage(`停止失败: ${getErrorMessage(e)}`, 'error')
    }
  }

  async function showAppWindow(appId: string) {
    try {
      await invoke('show_app_window', { appId })
    } catch { /* ignore */ }
  }

  return { loading, runningAppIds, runningPids, latestRuns, refreshRunningApps, launchApp, stopApp, showAppWindow }
}
