import { DOMWrapper, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsDialog from '@/components/app/SettingsDialog.vue'
import { buttonContaining } from '../../../helpers/dom'

function mountSettingsDialog() {
  return mount(SettingsDialog, {
    attachTo: document.body,
    props: {
      open: true,
      autostartEnabled: false,
      hideDockOnClose: false,
      logRetentionLimit: 20,
      themeIcon: 'system',
      themeLabel: '跟随系统',
    },
  })
}

describe('SettingsDialog', () => {
  it('emits settings actions from the dialog controls', async () => {
    const wrapper = mountSettingsDialog()

    expect(document.body.textContent).toContain('开机自启动')
    expect(document.body.textContent).toContain('菜单栏模式')
    expect(document.body.textContent).toContain('日志保留')

    const switches = Array.from(document.querySelectorAll('[role="switch"]')).map((item) => new DOMWrapper(item as HTMLElement))
    await switches[0].trigger('click')
    await switches[1].trigger('click')
    const retentionInput = document.querySelector('input[aria-label="日志保留数量"]')
    if (!retentionInput) throw new Error('Log retention input not found')
    await new DOMWrapper(retentionInput as HTMLElement).setValue('30')
    const themeButton = document.querySelector('button[aria-label="切换主题"]')
    if (!themeButton) throw new Error('Theme button not found')
    await new DOMWrapper(themeButton as HTMLElement).trigger('click')
    await buttonContaining(wrapper, '导出').trigger('click')
    await buttonContaining(wrapper, '导入').trigger('click')
    await buttonContaining(wrapper, '关闭').trigger('click')

    expect(wrapper.emitted('toggleAutostart')).toEqual([[true]])
    expect(wrapper.emitted('toggleHideDockOnClose')).toEqual([[true]])
    expect(wrapper.emitted('updateLogRetentionLimit')).toEqual([[30]])
    expect(wrapper.emitted('toggleTheme')).toHaveLength(1)
    expect(wrapper.emitted('exportData')).toHaveLength(1)
    expect(wrapper.emitted('importData')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
