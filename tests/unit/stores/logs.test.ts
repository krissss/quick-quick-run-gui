import { emit } from '@tauri-apps/api/event'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeApp, type AppItem } from '@/lib/store'
import { useLogsStore } from '@/stores/logs'
import { setupTauriMocks } from '../../helpers/tauri'

const app: AppItem = normalizeApp({
  id: 'app-1',
  name: 'Web App',
  type: 'web',
  command: 'pnpm dev',
  workingDirectory: '',
  url: 'http://localhost:3000',
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

function mountLogs() {
  setActivePinia(createPinia())
  const api = useLogsStore()
  const refs = storeToRefs(api)
  const wrapper = mount(defineComponent({
    setup() {
      return () => h('div')
    },
  }))
  return { api, ...refs, wrapper }
}

describe('logs store', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads logs, reacts to launch status events, polls updates, and closes cleanly', async () => {
    vi.useFakeTimers()
    const logs = { 'app-1': ['[qqr] started at 1767506400000: pnpm dev', 'first line'] }
    const runLogs = { 'run-1': logs['app-1'] }
    setupTauriMocks({
      store: { log_retention_limit: 12 },
      logs,
      recentRuns: [
        {
          id: 'run-1',
          app_id: 'app-1',
          app_name: 'Web App',
          item_type: 'web',
          status: 'running',
          pid: 1234,
          exit_code: null,
          started_at: 1767506400000,
          finished_at: null,
          command: 'pnpm dev',
          log_path: '/tmp/run-1.log',
          trigger: 'manual',
        },
      ],
      runLogs,
    })
    const { api, showLogDialog, logAppName, logRuns, selectedLogRunId, logLines, logWindowOpened, logLaunchFailed, logLaunchFailedReason, wrapper } = mountLogs()

    await api.openLogDialog(app)
    await flushPromises()

    expect(showLogDialog.value).toBe(true)
    expect(logAppName.value).toBe('Web App')
    expect(logRuns.value.map(run => run.id)).toEqual(['run-1'])
    expect(selectedLogRunId.value).toBe('run-1')
    expect(logLines.value[0]).not.toContain('1767506400000')
    expect(logLines.value[1]).toBe('first line')
    expect(logWindowOpened.value).toBe(false)

    await emit('app-launch-failed', { app_id: 'other', reason: 'timeout' })
    await emit('app-launch-failed', { app_id: 'app-1', reason: 'process_exited' })
    await emit('app-window-opened', 'app-1')
    await flushPromises()

    expect(logLaunchFailed.value).toBe(true)
    expect(logLaunchFailedReason.value).toBe('process_exited')
    expect(logWindowOpened.value).toBe(true)

    runLogs['run-1'] = ['[qqr] started at 1767506400000: pnpm dev', 'first line', 'second line']
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(logLines.value.at(-1)).toBe('second line')

    runLogs['run-1'] = [
      '[qqr] started at 1767506400000: pnpm dev',
      'first line',
      'second line',
      'final line',
    ]
    await emit('app-run-updated', { app_id: 'app-1', run_id: 'run-1', status: 'success' })
    await flushPromises()
    expect(logLines.value.at(-1)).toBe('final line')

    api.closeLogDialog()
    expect(showLogDialog.value).toBe(false)
    wrapper.unmount()
  })

  it('loads a selected historical run log', async () => {
    setupTauriMocks({
      recentRuns: [
        {
          id: 'run-new',
          app_id: 'app-1',
          app_name: 'Web App',
          item_type: 'task',
          status: 'failed',
          pid: null,
          exit_code: 1,
          started_at: 2000,
          finished_at: 3000,
          command: 'pnpm job --new',
          log_path: '/tmp/run-new.log',
          trigger: 'schedule',
        },
        {
          id: 'run-old',
          app_id: 'app-1',
          app_name: 'Web App',
          item_type: 'task',
          status: 'success',
          pid: null,
          exit_code: 0,
          started_at: 1000,
          finished_at: 1100,
          command: 'pnpm job --old',
          log_path: '/tmp/run-old.log',
          trigger: 'manual',
        },
      ],
      runLogs: {
        'run-new': ['new failed'],
        'run-old': ['old success'],
      },
    })
    const { api, logLines, selectedLogRunId, wrapper } = mountLogs()

    await api.openLogDialog({ ...app, type: 'task' }, true, 'run-old')
    await flushPromises()
    expect(logLines.value).toEqual(['old success'])
    expect(selectedLogRunId.value).toBe('run-old')

    await api.selectLogRun('run-new')
    await flushPromises()

    expect(selectedLogRunId.value).toBe('run-new')
    expect(logLines.value).toEqual(['new failed'])
    wrapper.unmount()
  })

  it('clears selected and completed historical logs', async () => {
    const mock = setupTauriMocks({
      recentRuns: [
        {
          id: 'run-new',
          app_id: 'app-1',
          app_name: 'Web App',
          item_type: 'task',
          status: 'failed',
          pid: null,
          exit_code: 1,
          started_at: 2000,
          finished_at: 3000,
          command: 'pnpm job --new',
          log_path: '/tmp/run-new.log',
          trigger: 'schedule',
        },
        {
          id: 'run-running',
          app_id: 'app-1',
          app_name: 'Web App',
          item_type: 'task',
          status: 'running',
          pid: 1234,
          exit_code: null,
          started_at: 3000,
          finished_at: null,
          command: 'pnpm job --running',
          log_path: '/tmp/run-running.log',
          trigger: 'manual',
        },
      ],
      runLogs: {
        'run-new': ['new failed'],
        'run-running': ['running'],
      },
    })
    const { api, logRuns, wrapper } = mountLogs()

    await api.openLogDialog({ ...app, type: 'task' }, true)
    await flushPromises()
    await api.clearSelectedLogRun()
    await flushPromises()

    expect(mock.getCalls('clear_app_logs').at(-1)?.payload).toMatchObject({
      appId: 'app-1',
      runIds: ['run-new'],
    })
    expect(logRuns.value.map(run => run.id)).toEqual(['run-running'])

    await api.clearAllLogRuns()
    await flushPromises()

    expect(logRuns.value.map(run => run.id)).toEqual(['run-running'])
    wrapper.unmount()
  })

  it('falls back to empty logs when log loading fails', async () => {
    vi.useFakeTimers()
    setupTauriMocks({ rejectCommands: { get_app_logs: new Error('missing logs') } })
    const { api, logLines, logWindowOpened, wrapper } = mountLogs()

    await api.openLogDialog({ ...app, type: 'task' }, true)
    await flushPromises()

    expect(logLines.value).toEqual([])
    expect(logWindowOpened.value).toBe(true)

    await vi.advanceTimersByTimeAsync(300)
    api.closeLogDialog()
    wrapper.unmount()
  })
})
