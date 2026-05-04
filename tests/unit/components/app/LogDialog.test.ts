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
      runs: [],
      selectedRunId: null,
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

  it('shows recent runs with formatted time and emits selection changes', async () => {
    const wrapper = mountLogDialog({
      runs: [
        {
          id: 'run-1',
          app_id: 'web-1',
          app_name: 'qwenpaw',
          item_type: 'task',
          status: 'success',
          pid: null,
          exit_code: 0,
          started_at: Date.UTC(2026, 4, 4, 6, 30, 0),
          finished_at: Date.UTC(2026, 4, 4, 6, 30, 2),
          log_path: '/tmp/run-1.log',
          trigger: 'schedule',
        },
      ],
      selectedRunId: 'run-1',
    })

    expect(document.body.textContent).toContain('最近运行')
    expect(document.body.textContent).toContain('成功')
    expect(document.body.textContent).toContain('定时')
    expect(document.body.textContent).not.toContain('1746340200000')

    await buttonContaining(wrapper, '成功').trigger('click')
    await buttonContaining(wrapper, '清理当前').trigger('click')
    await buttonContaining(wrapper, '清理全部').trigger('click')

    expect(wrapper.emitted('selectRun')).toEqual([['run-1']])
    expect(wrapper.emitted('clearSelected')).toHaveLength(1)
    expect(wrapper.emitted('clearAll')).toHaveLength(1)
  })
})
