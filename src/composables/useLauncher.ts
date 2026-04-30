import { ref, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppItem } from '@/lib/store'
import { getErrorMessage } from './useMessage'

interface RunningAppInfo {
  app_id: string
  pid: number | null
}

export function useLauncher(
  apps: { value: AppItem[] },
  showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void,
  openLogDialog: (app: AppItem) => void,
) {
  const loading = ref(false)
  const runningAppIds = ref<Set<string>>(new Set())
  const runningPids = ref<Map<string, number>>(new Map())

  async function refreshRunningApps() {
    try {
      const infos = await invoke<RunningAppInfo[]>('get_running_apps')
      runningAppIds.value = new Set(infos.map(info => info.app_id))
      runningPids.value = new Map(
        infos
          .filter((info): info is RunningAppInfo & { pid: number } => info.pid != null)
          .map(info => [info.app_id, info.pid]),
      )
    } catch { /* ignore */ }
  }

  function getBackgroundRGB(): [number, number, number] {
    const rgb = getComputedStyle(document.body).backgroundColor
    const m = rgb.match(/\d+/g)
    if (m && m.length >= 3) return [+m[0], +m[1], +m[2]]
    return [255, 255, 255]
  }

  async function launchApp(app: AppItem) {
    loading.value = true
    try {
      const [bgR, bgG, bgB] = getBackgroundRGB()
      const result = await invoke<{ message: string; pid: number | null }>('launch_app_window', {
        appId: app.id,
        command: app.command,
        url: app.url,
        width: app.width,
        height: app.height,
        appName: app.name,
        bgR,
        bgG,
        bgB,
      })
      if (result.pid != null) {
        const m = new Map(runningPids.value)
        m.set(app.id, result.pid)
        runningPids.value = m
      } else if (!app.command.trim()) {
        const m = new Map(runningPids.value)
        m.delete(app.id)
        runningPids.value = m
        showMessage(result.message, 'success')
      } else {
        showMessage(result.message, 'success')
      }
      const s = new Set(runningAppIds.value)
      s.add(app.id)
      runningAppIds.value = s
      if (app.command.trim()) {
        openLogDialog(app)
      }
    } catch (e: unknown) {
      showMessage(`启动失败: ${getErrorMessage(e)}`, 'error')
    }
    loading.value = false
  }

  // 事件监听
  const unlisteners: (() => void)[] = []

  onMounted(async () => {
    unlisteners.push(
      await listen<string>('app-launched', (e) => {
        const s = new Set(runningAppIds.value)
        s.add(e.payload)
        runningAppIds.value = s
      }),
      await listen<string>('app-stopped', (e) => {
        const s = new Set(runningAppIds.value)
        s.delete(e.payload)
        runningAppIds.value = s
        const m = new Map(runningPids.value)
        m.delete(e.payload)
        runningPids.value = m
      }),
      await listen<string>('app-process-stopped', (e) => {
        const m = new Map(runningPids.value)
        m.delete(e.payload)
        runningPids.value = m
      }),
      await listen<string>('tray-launch-app', async (e) => {
        const app = apps.value.find(a => a.id === e.payload)
        if (app) await launchApp(app)
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

  return { loading, runningAppIds, runningPids, refreshRunningApps, launchApp, stopApp, showAppWindow }
}
