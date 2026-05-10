import { DOMWrapper, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsDialog from '@/components/app/SettingsDialog.vue'
import { buttonContaining } from '../../../helpers/dom'

function mountSettingsDialog(props = {}) {
  return mount(SettingsDialog, {
    attachTo: document.body,
    props: {
      open: true,
      autostartEnabled: false,
      hideDockOnClose: false,
      logRetentionLimit: 20,
      checkingForUpdates: false,
      appVersion: '0.2.2',
      availableUpdateVersion: '',
      updateReleaseNotes: '',
      updateInProgress: false,
      updateProgressPercent: null,
      updateProgressLabel: '',
      themeIcon: 'system',
      themeLabel: '跟随系统',
      ...props,
    },
  })
}

describe('SettingsDialog', () => {
  it('emits settings actions from the dialog controls', async () => {
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

    expect(wrapper.emitted('toggleAutostart')).toEqual([[true]])
    expect(wrapper.emitted('toggleHideDockOnClose')).toEqual([[true]])
    expect(wrapper.emitted('updateLogRetentionLimit')).toEqual([[30]])
    expect(wrapper.emitted('toggleTheme')).toHaveLength(1)
    expect(wrapper.emitted('checkUpdates')).toHaveLength(1)
    expect(wrapper.emitted('installUpdate')).toBeUndefined()
    expect(wrapper.emitted('exportData')).toHaveLength(1)
    expect(wrapper.emitted('importData')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows available update details and install progress', async () => {
    const wrapper = mountSettingsDialog({
      availableUpdateVersion: '0.3.0',
      updateReleaseNotes: '- 修复更新体验\n- 增加下载进度',
      updateProgressLabel: '发现新版本 v0.3.0',
    })

    expect(document.body.textContent).toContain('发现新版本 v0.3.0')
    expect(document.body.textContent).toContain('修复更新体验')
    await buttonContaining(wrapper, '下载并安装').trigger('click')
    expect(wrapper.emitted('installUpdate')).toHaveLength(1)

    await wrapper.setProps({
      updateInProgress: true,
      updateProgressPercent: 42,
      updateProgressLabel: '正在下载 42%',
    })

    const progress = document.querySelector('[role="progressbar"]')
    expect(progress?.getAttribute('aria-valuenow')).toBe('42')
    expect(document.body.textContent).toContain('正在下载 42%')
    const closeIconButton = document.querySelector('button[aria-label="关闭设置"]')
    expect((closeIconButton as HTMLButtonElement | null)?.disabled).toBe(true)
  })
})
