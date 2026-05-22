import { nextTick } from 'vue'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { normalizeApp, type AppItem } from '@/lib/store'
import { useSettingsStore } from '@/stores/settings'
import { useAppCatalogStore } from '@/stores/apps/appCatalog'
import { useMessageStore } from '@/stores/message'
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
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  const catalog = useAppCatalogStore()
  const message = useMessageStore()
  const { apps } = storeToRefs(catalog)
  return { mock, settings, catalog, message, apps, ...storeToRefs(settings), ...storeToRefs(message) }
}

describe('settings store', () => {
  it('loads settings and toggles autostart, dock mode, and theme', async () => {
    localStorage.setItem('qqr-theme', 'light')
    const { mock, settings, hideDockOnClose, logRetentionLimit, autostartEnabled, appVersion, themeLabel, currentTheme, themeIcon, showSettingsDialog } = makeSettings({
      store: { hide_dock_on_close: true, log_retention_limit: 12 },
      autostartEnabled: true,
      appVersion: '0.2.2',
    })

    await settings.openSettingsDialog()

    expect(showSettingsDialog.value).toBe(true)
    expect(hideDockOnClose.value).toBe(true)
    expect(logRetentionLimit.value).toBe(12)
    expect(autostartEnabled.value).toBe(true)
    expect(appVersion.value).toBe('0.2.2')
    expect(themeLabel.value).toBe('亮色')

    settings.toggleTheme()
    expect(currentTheme.value).toBe('dark')
    expect(themeIcon.value).toBe('dark')
    expect(themeLabel.value).toBe('暗色')

    settings.toggleTheme()
    expect(currentTheme.value).toBe('system')
    expect(themeLabel.value).toBe('跟随系统')

    await settings.toggleAutostart(false)
    await settings.toggleAutostart(true)
    await settings.toggleHideDockOnClose(false)
    await settings.updateLogRetentionLimit(30)
    await settings.closeSettingsDialog()

    expect(showSettingsDialog.value).toBe(false)
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
    expect(messages.value.at(-1)?.text).toBe('已导出到 /tmp/export.json')

    await settings.handleImport()
    expect(apps.value).toHaveLength(1)
    expect(apps.value[0].name).toBe('From File')
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)
    expect(messages.value.at(-1)?.text).toBe('已导入 1 个应用')
  })

  it('checks, downloads, installs, and relaunches when an update is available', async () => {
    const { messages, mock, settings, availableUpdateVersion, updateReleaseNotes, updateInProgress, updateProgressLabel } = makeSettings({
      update: {
        rid: 7,
        version: '0.2.0',
        currentVersion: '0.1.0',
        body: '## 更新内容\n\n- **修复** [更新体验](https://example.com)\n- `确认后` 再安装',
      },
      updateDownloadEvents: [
        { event: 'Started', data: { contentLength: 100 } },
        { event: 'Progress', data: { chunkLength: 40 } },
        { event: 'Progress', data: { chunkLength: 60 } },
        { event: 'Finished' },
      ],
      holdUpdateDownload: true,
    })

    await settings.checkForUpdates()

    expect(mock.getCalls('plugin:updater|check')).toHaveLength(1)
    expect(availableUpdateVersion.value).toBe('0.2.0')
    expect(updateReleaseNotes.value).toContain('更新内容')
    expect(updateReleaseNotes.value).toContain('- 修复 更新体验')
    expect(updateReleaseNotes.value).toContain('- 确认后 再安装')
    expect(updateReleaseNotes.value).not.toContain('##')
    expect(updateReleaseNotes.value).not.toContain('https://example.com')
    expect(messages.value.map(item => item.text)).toEqual(['发现新版本 0.2.0'])

    const installing = settings.installAvailableUpdate()
    await nextTick()
    expect(updateInProgress.value).toBe(true)
    expect(updateProgressLabel.value).toBe('正在下载 100%')
    mock.resolveUpdateDownload()
    await installing

    expect(mock.getCalls('plugin:updater|download')[0].payload).toMatchObject({ rid: 7 })
    expect(mock.getCalls('plugin:updater|install')[0].payload).toMatchObject({ updateRid: 7, bytesRid: 1 })
    expect(mock.getCalls('plugin:updater|download_and_install')).toHaveLength(0)
    expect(mock.getCalls('plugin:process|restart')).toHaveLength(1)
  })
})
