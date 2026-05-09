import { computed, ref } from 'vue'
import { getTheme, setTheme, type Theme } from '@/lib/theme'
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from '@tauri-apps/plugin-autostart'
import { save } from '@tauri-apps/plugin-dialog'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { writeFile, readTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
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

export function useSettings(
  apps: { value: import('@/lib/store').AppItem[] },
  showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void,
) {
  const showSettingsDialog = ref(false)
  const autostartEnabled = ref(false)
  const hideDockOnClose = ref(false)
  const logRetentionLimit = ref(DEFAULT_LOG_RETENTION_LIMIT)
  const checkingForUpdates = ref(false)

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

  function closeSettingsDialog() {
    showSettingsDialog.value = false
  }

  async function checkForUpdates() {
    if (checkingForUpdates.value) return
    checkingForUpdates.value = true
    try {
      const update = await check()
      if (!update) {
        showMessage('当前已是最新版本', 'info')
        return
      }

      showMessage(`发现新版本 ${update.version}，正在下载并安装`, 'info')
      await update.downloadAndInstall()
      showMessage('更新已安装，正在重启应用', 'success')
      await relaunch()
    } catch (e: unknown) {
      showMessage(`检查更新失败: ${getErrorMessage(e)}`, 'error')
    } finally {
      checkingForUpdates.value = false
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
    showSettingsDialog, autostartEnabled, hideDockOnClose, logRetentionLimit, checkingForUpdates,
    currentTheme, themeIcon, themeLabel, toggleTheme,
    openSettingsDialog, toggleAutostart, toggleHideDockOnClose, updateLogRetentionLimit, closeSettingsDialog,
    checkForUpdates,
    handleExport, handleImport,
  }
}
