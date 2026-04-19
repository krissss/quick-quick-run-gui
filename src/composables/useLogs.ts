import { ref, nextTick, useTemplateRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppItem } from '@/lib/store'

export function useLogs() {
  const showLogDialog = ref(false)
  const logAppId = ref('')
  const logAppName = ref('')
  const logLines = ref<string[]>([])
  const logContainer = useTemplateRef<HTMLElement>('logContainer')
  const logLaunchFailed = ref(false)
  const logLaunchFailedReason = ref('')
  let logUnlisten: (() => void) | null = null
  let logFailedUnlisten: (() => void) | null = null

  async function openLogDialog(app: AppItem) {
    logAppId.value = app.id
    logAppName.value = app.name
    logLaunchFailed.value = false
    logLaunchFailedReason.value = ''
    try {
      logLines.value = await invoke<string[]>('get_app_logs', { appId: app.id })
    } catch {
      logLines.value = []
    }
    showLogDialog.value = true

    logUnlisten = await listen<{ app_id: string; lines: string[] }>('app-log-batch', (e) => {
      if (e.payload.app_id === logAppId.value) {
        logLines.value.push(...e.payload.lines)
        nextTick(() => {
          if (logContainer.value) {
            logContainer.value.scrollTop = logContainer.value.scrollHeight
          }
        })
      }
    })

    logFailedUnlisten = await listen<{ app_id: string; reason: string }>('app-launch-failed', (e) => {
      if (e.payload.app_id === logAppId.value) {
        logLaunchFailed.value = true
        logLaunchFailedReason.value = e.payload.reason
      }
    })
  }

  function closeLogDialog() {
    showLogDialog.value = false
    if (logUnlisten) { logUnlisten(); logUnlisten = null }
    if (logFailedUnlisten) { logFailedUnlisten(); logFailedUnlisten = null }
  }

  return { showLogDialog, logAppId, logAppName, logLines, logLaunchFailed, logLaunchFailedReason, openLogDialog, closeLogDialog }
}
