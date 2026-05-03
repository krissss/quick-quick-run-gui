import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppItem } from '@/lib/store'

export function useLogs() {
  const showLogDialog = ref(false)
  const logAppId = ref('')
  const logAppName = ref('')
  const logLines = ref<string[]>([])
  const logLaunchFailed = ref(false)
  const logLaunchFailedReason = ref('')
  const logWindowOpened = ref(false)
  let logFailedUnlisten: (() => void) | null = null
  let logOpenedUnlisten: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function openLogDialog(app: AppItem, windowAlreadyOpen = false) {
    logAppId.value = app.id
    logAppName.value = app.name
    logLaunchFailed.value = false
    logLaunchFailedReason.value = ''
    logWindowOpened.value = windowAlreadyOpen || app.type !== 'web'
    logLines.value = []

    // 先拉一次缓冲日志
    try {
      logLines.value = await invoke<string[]>('get_app_logs', { appId: app.id })
    } catch {
      logLines.value = []
    }
    showLogDialog.value = true

    // 监听状态事件
    logFailedUnlisten = await listen<{ app_id: string; reason: string }>('app-launch-failed', (e) => {
      if (e.payload.app_id === logAppId.value) {
        logLaunchFailed.value = true
        logLaunchFailedReason.value = e.payload.reason
      }
    })

    logOpenedUnlisten = await listen<string>('app-window-opened', (e) => {
      if (e.payload === logAppId.value) {
        logWindowOpened.value = true
      }
    })

    // 轮询拉取新日志（每 300ms）
    let lastCount = logLines.value.length
    pollTimer = setInterval(async () => {
      try {
        const all = await invoke<string[]>('get_app_logs', { appId: logAppId.value })
        if (all.length !== lastCount) {
          logLines.value = all
          lastCount = all.length
        }
      } catch { /* ignore */ }
    }, 300)
  }

  function closeLogDialog() {
    showLogDialog.value = false
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (logFailedUnlisten) { logFailedUnlisten(); logFailedUnlisten = null }
    if (logOpenedUnlisten) { logOpenedUnlisten(); logOpenedUnlisten = null }
  }

  return { showLogDialog, logAppId, logAppName, logLines, logLaunchFailed, logLaunchFailedReason, logWindowOpened, openLogDialog, closeLogDialog }
}
