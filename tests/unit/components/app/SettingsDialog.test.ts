import { DOMWrapper, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@/components/app/SettingsDialog.vue'
import { useSettingsStore } from '@/stores/settings'
import { buttonContaining } from '../../../helpers/dom'

function mountSettingsDialog(state: Partial<ReturnType<typeof useSettingsStore>> = {}) {
  const settingsStore = useSettingsStore()
  settingsStore.showSettingsDialog = true
  settingsStore.autostartEnabled = false
  settingsStore.hideDockOnClose = false
  settingsStore.logRetentionLimit = 20
  settingsStore.gracefulStopTimeoutSeconds = 10
  settingsStore.checkingForUpdates = false
  settingsStore.appVersion = '0.2.2'
  settingsStore.availableUpdateVersion = ''
  settingsStore.updateReleaseNotes = ''
  Object.assign(settingsStore, state)

  return mount(SettingsDialog, {
    attachTo: document.body,
  })
}

describe('SettingsDialog', () => {
  it('emits settings actions from the dialog controls', async () => {
    const settingsStore = useSettingsStore()
    const toggleAutostart = vi.spyOn(settingsStore, 'toggleAutostart').mockResolvedValue()
    const toggleHideDockOnClose = vi.spyOn(settingsStore, 'toggleHideDockOnClose').mockResolvedValue()
    const updateLogRetentionLimit = vi.spyOn(settingsStore, 'updateLogRetentionLimit').mockResolvedValue()
    const toggleTheme = vi.spyOn(settingsStore, 'toggleTheme').mockImplementation(() => {})
    const checkForUpdates = vi.spyOn(settingsStore, 'checkForUpdates').mockResolvedValue()
    const handleExport = vi.spyOn(settingsStore, 'handleExport').mockResolvedValue()
    const handleImport = vi.spyOn(settingsStore, 'handleImport').mockResolvedValue()
    const wrapper = mountSettingsDialog()

    expect(document.body.textContent).toContain('开机自启动')
    expect(document.body.textContent).toContain('菜单栏模式')
    expect(document.body.textContent).toContain('日志保留')
    expect(document.body.textContent).toContain('软件更新')
    expect(document.body.textContent).toContain('当前版本 v0.2.2')

    const switches = Array.from(document.querySelectorAll('[role="switch"]')).map((item) => new DOMWrapper(item as HTMLElement))
    await switches[0].trigger('click')
    await switches[1].trigger('click')
    const retentionInput = document.querySelector('input[aria-label="日志保留数量"]')
    if (!retentionInput) throw new Error('Log retention input not found')
    await new DOMWrapper(retentionInput as HTMLElement).setValue('30')
    const themeButton = document.querySelector('button[aria-label="切换主题"]')
    if (!themeButton) throw new Error('Theme button not found')
    await new DOMWrapper(themeButton as HTMLElement).trigger('click')
    await buttonContaining(wrapper, '检查更新').trigger('click')
    await buttonContaining(wrapper, '导出').trigger('click')
    await buttonContaining(wrapper, '导入').trigger('click')
    const closeIconButton = document.querySelector('button[aria-label="关闭设置"]')
    if (!closeIconButton) throw new Error('Settings close icon button not found')
    await new DOMWrapper(closeIconButton as HTMLElement).trigger('click')

    expect(toggleAutostart).toHaveBeenCalledWith(true)
    expect(toggleHideDockOnClose).toHaveBeenCalledWith(true)
    expect(updateLogRetentionLimit).toHaveBeenCalledWith(30)
    expect(toggleTheme).toHaveBeenCalledOnce()
    expect(checkForUpdates).toHaveBeenCalledOnce()
    expect(handleExport).toHaveBeenCalledOnce()
    expect(handleImport).toHaveBeenCalledOnce()
    expect(settingsStore.showSettingsDialog).toBe(false)
  })

  it('shows available update details and installs the available update', async () => {
    const settingsStore = useSettingsStore()
    const installAvailableUpdate = vi.spyOn(settingsStore, 'installAvailableUpdate').mockResolvedValue()
    const wrapper = mountSettingsDialog({
      availableUpdateVersion: '0.3.0',
      updateReleaseNotes: '- 修复更新体验\n- 增加下载进度',
    })

    expect(document.body.textContent).toContain('发现新版本 v0.3.0')
    expect(document.body.textContent).toContain('修复更新体验')
    await buttonContaining(wrapper, '下载并安装').trigger('click')
    expect(installAvailableUpdate).toHaveBeenCalledOnce()
  })
})
