import { computed, ref, shallowRef } from 'vue'
import { getTheme, setTheme, type Theme } from '@/lib/theme'
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from '@tauri-apps/plugin-autostart'
import { open as dialogOpen, save } from '@tauri-apps/plugin-dialog'
import { writeFile, readTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import {
  DEFAULT_LOG_RETENTION_LIMIT,
  exportData,
  importData,
  loadHideDockOnClose,
  loadLogRetentionLimit,
  normalizeLogRetentionLimit,
  saveHideDockOnClose,
  saveLogRetentionLimit,
} from '@/lib/store'
import { getErrorMessage } from './useMessage'

const UPDATE_BODY_PREVIEW_LIMIT = 1200

function decodeBasicHtmlEntities(text: string) {
  return text.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, entity: string) => {
    const entities: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      '#39': "'",
    }
    return entities[entity] ?? _
  })
}

function markdownToDialogText(markdown: string) {
  const text = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^```[^\n]*\n?/gm, '')
    .replace(/^~~~[^\n]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/^~~~\s*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    .replace(/<\/?[^>\n]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '- ')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return decodeBasicHtmlEntities(text)
}

function formatUpdateReleaseNotes(body?: string) {
  const updateBody = body ? markdownToDialogText(body) : ''
  if (!updateBody) return ''

  return updateBody.length > UPDATE_BODY_PREVIEW_LIMIT
    ? `${updateBody.slice(0, UPDATE_BODY_PREVIEW_LIMIT).trimEnd()}\n...`
    : updateBody
}

export function useSettings(
  apps: { value: import('@/lib/store').AppItem[] },
  showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void,
) {
  const showSettingsDialog = ref(false)
  const autostartEnabled = ref(false)
  const hideDockOnClose = ref(false)
  const logRetentionLimit = ref(DEFAULT_LOG_RETENTION_LIMIT)
  const checkingForUpdates = ref(false)
  const appVersion = ref('')
  const availableUpdate = shallowRef<Update | null>(null)
  const availableUpdateVersion = ref('')
  const updateReleaseNotes = ref('')
  const updateStatus = ref<'idle' | 'available' | 'downloading' | 'installing'>('idle')
  const updateDownloadedBytes = ref(0)
  const updateContentLength = ref<number | null>(null)
  const updateInProgress = computed(() => updateStatus.value === 'downloading' || updateStatus.value === 'installing')
  const updateProgressPercent = computed(() => {
    if (updateStatus.value === 'installing') return 100
    if (updateStatus.value !== 'downloading') return null
    if (!updateContentLength.value) return null
    return Math.min(100, Math.round((updateDownloadedBytes.value / updateContentLength.value) * 100))
  })
  const updateProgressLabel = computed(() => {
    if (checkingForUpdates.value) return '正在检查更新'
    if (updateStatus.value === 'available' && availableUpdateVersion.value) return `发现新版本 v${availableUpdateVersion.value}`
    if (updateStatus.value === 'downloading') {
      return updateProgressPercent.value == null ? '正在下载更新' : `正在下载 ${updateProgressPercent.value}%`
    }
    if (updateStatus.value === 'installing') return '正在安装更新'
    return ''
  })

  // 主题
  const currentTheme = ref<Theme>(getTheme())
  function toggleTheme() {
    const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
    currentTheme.value = next[currentTheme.value]
    setTheme(currentTheme.value)
  }
  const themeIcon = computed(() => currentTheme.value)
  const themeLabel = computed(() => {
    if (currentTheme.value === 'light') return '亮色'
    if (currentTheme.value === 'dark') return '暗色'
    return '跟随系统'
  })

  async function openSettingsDialog() {
    showSettingsDialog.value = true
    try {
      appVersion.value = await getVersion()
    } catch {
      appVersion.value = ''
    }
    try {
      hideDockOnClose.value = await loadHideDockOnClose()
    } catch {
      hideDockOnClose.value = false
    }
    try {
      logRetentionLimit.value = await loadLogRetentionLimit()
    } catch {
      logRetentionLimit.value = DEFAULT_LOG_RETENTION_LIMIT
    }
    try {
      autostartEnabled.value = await autostartIsEnabled()
    } catch {
      autostartEnabled.value = false
    }
  }

  async function toggleAutostart(value: boolean) {
    try {
      if (value) { await autostartEnable(); autostartEnabled.value = true }
      else { await autostartDisable(); autostartEnabled.value = false }
    } catch (e: unknown) {
      showMessage(`设置自启动失败: ${getErrorMessage(e)}`, 'error')
    }
  }

  async function toggleHideDockOnClose(value: boolean) {
    try {
      await saveHideDockOnClose(value)
      hideDockOnClose.value = value
    } catch (e: unknown) {
      showMessage(`保存菜单栏模式失败: ${getErrorMessage(e)}`, 'error')
    }
  }

  async function updateLogRetentionLimit(value: number) {
    const next = normalizeLogRetentionLimit(value)
    try {
      await saveLogRetentionLimit(next)
      try { await invoke('prune_log_records') } catch { /* ignore; next run will prune */ }
      logRetentionLimit.value = next
    } catch (e: unknown) {
      showMessage(`保存日志保留数量失败: ${getErrorMessage(e)}`, 'error')
    }
  }

  async function closeSettingsDialog() {
    if (updateInProgress.value) return
    showSettingsDialog.value = false
    await clearAvailableUpdate()
  }

  function resetUpdateProgress() {
    updateDownloadedBytes.value = 0
    updateContentLength.value = null
  }

  async function clearAvailableUpdate() {
    const update = availableUpdate.value
    availableUpdate.value = null
    availableUpdateVersion.value = ''
    updateReleaseNotes.value = ''
    updateStatus.value = 'idle'
    resetUpdateProgress()
    if (update) {
      try { await update.close() } catch { /* best-effort resource cleanup */ }
    }
  }

  function handleDownloadEvent(event: DownloadEvent) {
    if (event.event === 'Started') {
      updateContentLength.value = event.data.contentLength ?? null
      updateDownloadedBytes.value = 0
      return
    }
    if (event.event === 'Progress') {
      updateDownloadedBytes.value += event.data.chunkLength
      return
    }
    if (event.event === 'Finished' && updateContentLength.value != null) {
      updateDownloadedBytes.value = updateContentLength.value
    }
  }

  async function checkForUpdates() {
    if (checkingForUpdates.value || updateInProgress.value) return
    checkingForUpdates.value = true
    try {
      await clearAvailableUpdate()

      const update = await check()
      if (!update) {
        showMessage('当前已是最新版本', 'info')
        return
      }

      availableUpdate.value = update
      availableUpdateVersion.value = update.version
      updateReleaseNotes.value = formatUpdateReleaseNotes(update.body)
      updateStatus.value = 'available'
      showMessage(`发现新版本 ${update.version}`, 'info')
    } catch (e: unknown) {
      showMessage(`检查更新失败: ${getErrorMessage(e)}`, 'error')
    } finally {
      checkingForUpdates.value = false
    }
  }

  async function installAvailableUpdate() {
    if (!availableUpdate.value || updateInProgress.value) return
    const update = availableUpdate.value
    resetUpdateProgress()
    updateStatus.value = 'downloading'
    try {
      showMessage(`正在下载并安装 ${update.version}`, 'info')
      await update.download(handleDownloadEvent)
      updateStatus.value = 'installing'
      await update.install()
      await clearAvailableUpdate()
      showMessage('更新已安装，正在重启应用', 'success')
      try {
        await relaunch()
      } catch (e: unknown) {
        showMessage(`更新已安装，请手动重启应用: ${getErrorMessage(e)}`, 'error')
      }
    } catch (e: unknown) {
      await clearAvailableUpdate()
      showMessage(`更新失败: ${getErrorMessage(e)}`, 'error')
    } finally {
      if (!availableUpdate.value) resetUpdateProgress()
    }
  }

  // 导入/导出
  async function handleExport() {
    try {
      const json = await exportData()
      const filePath = await save({
        defaultPath: 'qqr-apps-export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!filePath) return
      await writeFile(filePath, new TextEncoder().encode(json))
      showMessage(`已导出到 ${filePath}`, 'success')
    } catch (e: unknown) {
      showMessage(`导出失败: ${getErrorMessage(e)}`, 'error')
    }
  }

  async function handleImport() {
    try {
      const filePath = await dialogOpen({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      })
      if (!filePath) return
      const json = await readTextFile(filePath)
      const imported = await importData(json)
      apps.value = imported
      showMessage(`已导入 ${imported.length} 个应用`, 'success')
      try { await invoke('notify_apps_updated') } catch { /* ignore */ }
    } catch (e: unknown) {
      showMessage(`导入失败: ${getErrorMessage(e)}`, 'error')
    }
  }

  return {
    showSettingsDialog, autostartEnabled, hideDockOnClose, logRetentionLimit, checkingForUpdates, appVersion,
    availableUpdateVersion, updateReleaseNotes, updateInProgress, updateProgressPercent, updateProgressLabel,
    currentTheme, themeIcon, themeLabel, toggleTheme,
    openSettingsDialog, toggleAutostart, toggleHideDockOnClose, updateLogRetentionLimit, closeSettingsDialog,
    checkForUpdates, installAvailableUpdate,
    handleExport, handleImport,
  }
}
