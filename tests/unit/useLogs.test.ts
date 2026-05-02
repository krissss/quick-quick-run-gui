import { emit } from '@tauri-apps/api/event'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLogs } from '@/composables/useLogs'
import type { AppItem } from '@/lib/store'
import { setupTauriMocks } from '../helpers/tauri'

const app: AppItem = {
  id: 'app-1',
  name: 'Web App',
  type: 'web',
  command: 'pnpm dev',
  url: 'http://localhost:3000',
  width: 1200,
  height: 800,
  schedule: {
    enabled: false,
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    missedPolicy: 'skip',
  },
}

function mountLogs() {
  let api!: ReturnType<typeof useLogs>
  const wrapper = mount(defineComponent({
    setup() {
      api = useLogs()
      return () => h('div', { ref: 'logContainer' })
    },
  }))
  return { api, wrapper }
}

describe('useLogs', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads logs, reacts to launch status events, polls updates, and closes cleanly', async () => {
    vi.useFakeTimers()
    const logs = { 'app-1': ['first line'] }
    setupTauriMocks({ logs })
    const { api, wrapper } = mountLogs()

    await api.openLogDialog(app)
    await flushPromises()

    expect(api.showLogDialog.value).toBe(true)
    expect(api.logAppName.value).toBe('Web App')
    expect(api.logLines.value).toEqual(['first line'])
    expect(api.logWindowOpened.value).toBe(false)

    await emit('app-launch-failed', { app_id: 'other', reason: 'timeout' })
    await emit('app-launch-failed', { app_id: 'app-1', reason: 'process_exited' })
    await emit('app-window-opened', 'app-1')
    await flushPromises()

    expect(api.logLaunchFailed.value).toBe(true)
    expect(api.logLaunchFailedReason.value).toBe('process_exited')
    expect(api.logWindowOpened.value).toBe(true)

    logs['app-1'] = ['first line', 'second line']
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(api.logLines.value).toEqual(['first line', 'second line'])

    api.closeLogDialog()
    expect(api.showLogDialog.value).toBe(false)
    wrapper.unmount()
  })

  it('falls back to empty logs when log loading fails', async () => {
    vi.useFakeTimers()
    setupTauriMocks({ rejectCommands: { get_app_logs: new Error('missing logs') } })
    const { api, wrapper } = mountLogs()

    await api.openLogDialog({ ...app, type: 'task' }, true)
    await flushPromises()

    expect(api.logLines.value).toEqual([])
    expect(api.logWindowOpened.value).toBe(true)

    await vi.advanceTimersByTimeAsync(300)
    api.closeLogDialog()
    wrapper.unmount()
  })
})
