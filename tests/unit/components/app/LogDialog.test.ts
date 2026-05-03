import { DOMWrapper, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LogDialog from '@/components/app/LogDialog.vue'
import { buttonContaining } from '../../../helpers/dom'

function mountLogDialog(props = {}) {
  return mount(LogDialog, {
    attachTo: document.body,
    props: {
      open: true,
      appId: 'web-1',
      appName: 'qwenpaw',
      lines: ['ready'],
      launchFailed: false,
      launchFailedReason: '',
      windowOpened: false,
      runningAppIds: new Set(['web-1']),
      ...props,
    },
  })
}

describe('LogDialog', () => {
  it('shows startup state, log lines, and closes from the overlay', async () => {
    const wrapper = mountLogDialog()

    expect(document.body.textContent).toContain('qwenpaw — 日志')
    expect(document.body.textContent).toContain('启动中')
    expect(document.body.textContent).toContain('ready')

    const overlay = document.querySelector('.fixed.inset-0')
    if (!overlay) throw new Error('Overlay not found')
    await new DOMWrapper(overlay as HTMLElement).trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows failed launch state and emits relaunch', async () => {
    const wrapper = mountLogDialog({
      launchFailed: true,
      launchFailedReason: 'process_exited',
      windowOpened: false,
    })

    expect(document.body.textContent).toContain('进程已退出')
    await buttonContaining(wrapper, '重新启动').trigger('click')

    expect(wrapper.emitted('relaunch')).toEqual([['web-1']])
  })
})
