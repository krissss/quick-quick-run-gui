import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSettings } from '@/composables/useSettings'
import { normalizeApp, type AppItem } from '@/lib/store'
import { setupTauriMocks } from '../../helpers/tauri'

const importedApp: AppItem = normalizeApp({
  id: 'imported',
  name: 'Imported',
  type: 'service',
  command: 'pnpm serve',
  workingDirectory: '',
  url: '',
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

function makeSettings(options: Parameters<typeof setupTauriMocks>[0] = {}) {
  const mock = setupTauriMocks(options)
  const apps = ref<AppItem[]>([])
  const messages: Array<{ text: string; type?: string }> = []
  const settings = useSettings(apps, (text, type) => messages.push({ text, type }))
  return { apps, messages, mock, settings }
}

describe('useSettings', () => {
  it('loads settings and toggles autostart, dock mode, and theme', async () => {
    localStorage.setItem('qqr-theme', 'light')
    const { mock, settings } = makeSettings({
      store: { hide_dock_on_close: true, log_retention_limit: 12 },
      autostartEnabled: true,
    })

    await settings.openSettingsDialog()

    expect(settings.showSettingsDialog.value).toBe(true)
    expect(settings.hideDockOnClose.value).toBe(true)
    expect(settings.logRetentionLimit.value).toBe(12)
    expect(settings.autostartEnabled.value).toBe(true)
    expect(settings.themeLabel.value).toBe('亮色')

    settings.toggleTheme()
    expect(settings.currentTheme.value).toBe('dark')
    expect(settings.themeIcon.value).toBe('dark')
    expect(settings.themeLabel.value).toBe('暗色')

    settings.toggleTheme()
    expect(settings.currentTheme.value).toBe('system')
    expect(settings.themeLabel.value).toBe('跟随系统')

    await settings.toggleAutostart(false)
    await settings.toggleAutostart(true)
    await settings.toggleHideDockOnClose(false)
    await settings.updateLogRetentionLimit(30)
    settings.closeSettingsDialog()

    expect(settings.showSettingsDialog.value).toBe(false)
    expect(mock.storeData.hide_dock_on_close).toBe(false)
    expect(mock.storeData.log_retention_limit).toBe(30)
    expect(mock.getCalls('prune_log_records')).toHaveLength(1)
    expect(mock.getCalls('plugin:autostart|disable')).toHaveLength(1)
    expect(mock.getCalls('plugin:autostart|enable')).toHaveLength(1)
  })

  it('exports and imports app data through dialog and fs plugins', async () => {
    const { apps, messages, mock, settings } = makeSettings({
      store: { apps: [importedApp] },
      dialogSavePath: '/tmp/export.json',
      dialogOpenPath: '/tmp/import.json',
      files: {
        '/tmp/import.json': JSON.stringify([{ ...importedApp, id: 'from-file', name: 'From File' }]),
      },
    })

    await settings.handleExport()
    expect(mock.getCalls('plugin:dialog|save')).toHaveLength(1)
    const writeCall = mock.getCalls('plugin:fs|write_file')[0]
    expect(writeCall.options).toMatchObject({
      headers: {
        path: encodeURIComponent('/tmp/export.json'),
      },
    })
    const exportedJson = new TextDecoder().decode(writeCall.payload as Uint8Array)
    expect(JSON.parse(exportedJson)).toMatchObject([{ id: 'imported', name: 'Imported' }])
    expect(messages.at(-1)).toEqual({ text: '已导出到 /tmp/export.json', type: 'success' })

    await settings.handleImport()
    expect(apps.value).toHaveLength(1)
    expect(apps.value[0].name).toBe('From File')
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)
    expect(messages.at(-1)).toEqual({ text: '已导入 1 个应用', type: 'success' })
  })

  it('checks, installs, and relaunches when an update is available', async () => {
    const { messages, mock, settings } = makeSettings({
      update: { rid: 7, version: '0.2.0', currentVersion: '0.1.0' },
    })

    await settings.checkForUpdates()

    expect(mock.getCalls('plugin:updater|check')).toHaveLength(1)
    expect(mock.getCalls('plugin:updater|download_and_install')[0].payload).toMatchObject({ rid: 7 })
    expect(mock.getCalls('plugin:process|restart')).toHaveLength(1)
    expect(messages).toEqual([
      { text: '发现新版本 0.2.0，正在下载并安装', type: 'info' },
      { text: '更新已安装，正在重启应用', type: 'success' },
    ])
  })

  it('reports when no update is available', async () => {
    const { messages, settings } = makeSettings({ update: null })

    await settings.checkForUpdates()

    expect(messages.at(-1)).toEqual({ text: '当前已是最新版本', type: 'info' })
  })

  it('handles cancellation and plugin failures without mutating state unexpectedly', async () => {
    const cancelled = makeSettings({ dialogSavePath: null, dialogOpenPath: null })
    await cancelled.settings.handleExport()
    await cancelled.settings.handleImport()
    expect(cancelled.messages).toEqual([])

    const failing = makeSettings({
      rejectCommands: {
        'plugin:autostart|is_enabled': new Error('autostart failed'),
        'plugin:store|get': new Error('store failed'),
        'plugin:autostart|enable': new Error('enable failed'),
        'plugin:dialog|save': new Error('save failed'),
        'plugin:dialog|open': new Error('open failed'),
        'plugin:updater|check': new Error('network failed'),
      },
    })

    await failing.settings.openSettingsDialog()
    expect(failing.settings.hideDockOnClose.value).toBe(false)
    expect(failing.settings.autostartEnabled.value).toBe(false)

    await failing.settings.toggleAutostart(true)
    await failing.settings.updateLogRetentionLimit(30)
    await failing.settings.handleExport()
    await failing.settings.handleImport()
    await failing.settings.checkForUpdates()

    expect(failing.messages.map((item) => item.type)).toEqual(['error', 'error', 'error', 'error'])
    expect(failing.messages.at(-1)).toEqual({ text: '检查更新失败: network failed', type: 'error' })
  })

  it('reports dock preference save failures', async () => {
    const { messages, settings } = makeSettings({
      rejectCommands: { 'plugin:store|set': new Error('write failed') },
    })

    await settings.toggleHideDockOnClose(true)

    expect(messages.at(-1)).toEqual({ text: '保存菜单栏模式失败: write failed', type: 'error' })
  })
})
