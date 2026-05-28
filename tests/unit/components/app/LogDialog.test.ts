import { DOMWrapper, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import LogDialog from '@/components/app/LogDialog.vue'
import { useAppSessionStore } from '@/stores/appSession'
import { useLauncherStore } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import { buttonContaining } from '../../../helpers/dom'

function mountLogDialog(state: Partial<ReturnType<typeof useLogsStore>> = {}) {
  const logsStore = useLogsStore()
  const launcherStore = useLauncherStore()
  logsStore.showLogDialog = true
  logsStore.logAppId = 'web-1'
  logsStore.logAppName = 'demo-web'
  logsStore.logLines = ['ready']
  logsStore.logRuns = []
  logsStore.selectedLogRunId = null
  logsStore.logLaunchFailed = false
  logsStore.logLaunchFailedReason = ''
  logsStore.logWindowOpened = false
  launcherStore.runningAppIds = new Set(['web-1'])
  Object.assign(logsStore, state)

  return mount(LogDialog, {
    attachTo: document.body,
  })
}

describe('LogDialog', () => {
  it('shows startup state, log lines, and closes from the overlay', async () => {
    const wrapper = mountLogDialog()

    expect(document.body.textContent).toContain('demo-web — 日志')
    expect(document.body.textContent).toContain('启动中')
    expect(document.body.textContent).toContain('ready')
    expect(document.querySelector('button[aria-label="关闭日志"]')).toBeTruthy()

    const overlay = document.querySelector('.fixed.inset-0')
    if (!overlay) throw new Error('Overlay not found')
    await new DOMWrapper(overlay as HTMLElement).trigger('click')

    expect(useLogsStore().showLogDialog).toBe(false)
  })

  it('shows failed launch state and emits relaunch', async () => {
    const wrapper = mountLogDialog()
    const logsStore = useLogsStore()
    logsStore.logLaunchFailed = true
    logsStore.logLaunchFailedReason = 'process_exited'
    logsStore.logWindowOpened = false
    const relaunchFromLog = vi.spyOn(useAppSessionStore(), 'relaunchFromLog').mockResolvedValue()
    await nextTick()

    expect(document.body.textContent).toContain('进程已退出')
    await buttonContaining(wrapper, '重新启动').trigger('click')

    expect(relaunchFromLog).toHaveBeenCalledWith('web-1')
  })

  it('shows recent runs with formatted time and emits selection changes', async () => {
    const logsStore = useLogsStore()
    const selectLogRun = vi.spyOn(logsStore, 'selectLogRun').mockResolvedValue()
    const clearSelectedLogRun = vi.spyOn(logsStore, 'clearSelectedLogRun').mockResolvedValue()
    const clearAllLogRuns = vi.spyOn(logsStore, 'clearAllLogRuns').mockResolvedValue()
    const wrapper = mountLogDialog({
      logRuns: [
        {
          id: 'run-1',
          app_id: 'web-1',
          app_name: 'demo-web',
          item_type: 'task',
          status: 'success',
          pid: null,
          exit_code: 0,
          started_at: Date.UTC(2026, 4, 4, 6, 30, 0),
          finished_at: Date.UTC(2026, 4, 4, 6, 30, 2),
          command: 'pnpm daily --date today',
          log_path: '/tmp/run-1.log',
          trigger: 'schedule',
        },
      ],
      selectedLogRunId: 'run-1',
    })
    await nextTick()

    expect(document.body.textContent).toContain('最近运行')
    expect(document.body.textContent).toContain('成功')
    expect(document.body.textContent).toContain('定时')
    expect(document.body.textContent).toContain('pnpm daily --date today')
    expect(document.body.textContent).not.toContain('1746340200000')
    const panel = document.querySelector('section[role="dialog"]')
    const body = document.querySelector('[data-testid="log-dialog-body"]')
    const runList = document.querySelector('[data-testid="log-run-list"]')
    const logLines = document.querySelector('[data-testid="log-lines"]')
    expect(panel?.className).toContain('h-[min(calc(100dvh-2rem),42rem)]')
    expect(panel?.className).toContain('max-h-[calc(100dvh-2rem)]')
    expect(body?.className).toContain('flex-col')
    expect(body?.className).toContain('md:grid')
    expect(runList?.className).toContain('max-h-36')
    expect(runList?.className).toContain('overflow-y-auto')
    expect(logLines?.className).toContain('min-h-0')
    expect(logLines?.className).toContain('overflow-auto')
    expect(logLines?.className).toContain('bg-[#1e1e2e]')
    expect(logLines?.querySelector('.whitespace-pre')).toBeTruthy()

    await buttonContaining(wrapper, '成功').trigger('click')
    await buttonContaining(wrapper, '清理当前').trigger('click')
    await buttonContaining(wrapper, '清理全部').trigger('click')

    expect(selectLogRun).toHaveBeenCalledWith('run-1')
    expect(clearSelectedLogRun).toHaveBeenCalledOnce()
    expect(clearAllLogRuns).toHaveBeenCalledOnce()
  })

  it('marks running run records as pending confirmation when backend running state is missing', async () => {
    mountLogDialog({
      logRuns: [
        {
          id: 'run-stale',
          app_id: 'web-1',
          app_name: 'demo-web',
          item_type: 'web',
          status: 'running',
          pid: 4321,
          exit_code: null,
          started_at: Date.UTC(2026, 4, 4, 6, 30, 0),
          finished_at: null,
          command: 'pnpm dev',
          log_path: '/tmp/run-stale.log',
          trigger: 'manual',
        },
      ],
      selectedLogRunId: 'run-stale',
    })
    useLauncherStore().runningAppIds = new Set()
    await nextTick()

    expect(document.body.textContent).toContain('状态待确认')
    expect(document.querySelector('[data-testid="log-run-list"]')?.textContent).not.toContain('运行中')
  })
})
