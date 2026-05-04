import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { DEFAULT_LOG_RETENTION_LIMIT, loadLogRetentionLimit, type AppItem } from '@/lib/store'
import type { RunRecord } from '@/composables/useLauncher'
import { formatLogLine } from '@/lib/time'
import { getErrorMessage } from './useMessage'

interface RunUpdatedPayload {
  app_id: string
  run_id: string
  status: RunRecord['status']
}

interface ClearLogsResult {
  removed: number
}

export function useLogs(
  showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void = () => {},
) {
  const showLogDialog = ref(false)
  const logAppId = ref('')
  const logAppName = ref('')
  const logLines = ref<string[]>([])
  const logRuns = ref<RunRecord[]>([])
  const selectedLogRunId = ref<string | null>(null)
  const logLaunchFailed = ref(false)
  const logLaunchFailedReason = ref('')
  const logWindowOpened = ref(false)
  let logFailedUnlisten: (() => void) | null = null
  let logOpenedUnlisten: (() => void) | null = null
  let logRunUnlisten: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function formatLines(lines: string[]) {
    return lines.map(formatLogLine)
  }

  function selectedRun() {
    return logRuns.value.find(run => run.id === selectedLogRunId.value)
  }

  async function loadLogRuns() {
    try {
      let limit = DEFAULT_LOG_RETENTION_LIMIT
      try {
        limit = await loadLogRetentionLimit()
      } catch { /* use default */ }
      const runs = await invoke<RunRecord[]>('get_app_log_runs', { appId: logAppId.value, limit })
      logRuns.value = runs
      if (selectedLogRunId.value && runs.some(run => run.id === selectedLogRunId.value)) return
      selectedLogRunId.value = runs[0]?.id ?? null
    } catch {
      logRuns.value = []
      selectedLogRunId.value = null
    }
  }

  async function loadLogLines(runId = selectedLogRunId.value) {
    try {
      const payload: { appId: string; runId?: string } = { appId: logAppId.value }
      if (runId) payload.runId = runId
      logLines.value = formatLines(await invoke<string[]>('get_app_logs', payload))
    } catch {
      logLines.value = []
    }
  }

  async function selectLogRun(runId: string | null) {
    selectedLogRunId.value = runId
    await loadLogLines(runId)
  }

  async function clearLogRuns(runIds?: string[]) {
    try {
      const result = await invoke<ClearLogsResult>('clear_app_logs', {
        appId: logAppId.value,
        runIds,
      })
      await loadLogRuns()
      await loadLogLines()
      showMessage(result.removed > 0 ? `已清理 ${result.removed} 条日志` : '没有可清理的日志', 'success')
    } catch (e: unknown) {
      showMessage(`清理日志失败: ${getErrorMessage(e)}`, 'error')
    }
  }

  async function clearSelectedLogRun() {
    if (!selectedLogRunId.value) return
    await clearLogRuns([selectedLogRunId.value])
  }

  async function clearAllLogRuns() {
    await clearLogRuns()
  }

  function cleanupLogSubscriptions() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (logFailedUnlisten) { logFailedUnlisten(); logFailedUnlisten = null }
    if (logOpenedUnlisten) { logOpenedUnlisten(); logOpenedUnlisten = null }
    if (logRunUnlisten) { logRunUnlisten(); logRunUnlisten = null }
  }

  async function openLogDialog(app: AppItem, windowAlreadyOpen = false) {
    cleanupLogSubscriptions()
    logAppId.value = app.id
    logAppName.value = app.name
    logLaunchFailed.value = false
    logLaunchFailedReason.value = ''
    logWindowOpened.value = windowAlreadyOpen || app.type !== 'web'
    logLines.value = []
    logRuns.value = []
    selectedLogRunId.value = null

    await loadLogRuns()
    await loadLogLines()
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

    logRunUnlisten = await listen<RunUpdatedPayload>('app-run-updated', async (e) => {
      if (e.payload.app_id === logAppId.value) {
        const shouldRefreshLines = selectedLogRunId.value == null || selectedLogRunId.value === e.payload.run_id
        await loadLogRuns()
        if (shouldRefreshLines) await loadLogLines()
      }
    })

    // 轮询拉取新日志（每 300ms）
    let lastCount = logLines.value.length
    pollTimer = setInterval(async () => {
      try {
        const run = selectedRun()
        if (run && run.status !== 'running') return
        const payload: { appId: string; runId?: string } = { appId: logAppId.value }
        if (selectedLogRunId.value) payload.runId = selectedLogRunId.value
        const all = formatLines(await invoke<string[]>('get_app_logs', payload))
        if (all.length !== lastCount) {
          logLines.value = all
          lastCount = all.length
        }
      } catch { /* ignore */ }
    }, 300)
  }

  function closeLogDialog() {
    showLogDialog.value = false
    cleanupLogSubscriptions()
  }

  return {
    showLogDialog,
    logAppId,
    logAppName,
    logLines,
    logRuns,
    selectedLogRunId,
    logLaunchFailed,
    logLaunchFailedReason,
    logWindowOpened,
    openLogDialog,
    selectLogRun,
    clearSelectedLogRun,
    clearAllLogRuns,
    closeLogDialog,
  }
}
