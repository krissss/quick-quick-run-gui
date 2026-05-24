import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RunningAppCard from '@/components/app/RunningAppCard.vue'
import { useAppSessionStore } from '@/stores/appSession'
import { useLauncherStore, type RunRecord } from '@/stores/launcher'
import { webApp } from '../../../fixtures/apps'
import { setupTauriMocks } from '../../../helpers/tauri'

function mountRunningCard() {
  const launcherStore = useLauncherStore()
  const activeRun: RunRecord = {
    id: 'run-web-active',
    app_id: 'web-1',
    app_name: 'demo-web',
    item_type: 'web',
    status: 'running',
    pid: 4321,
    exit_code: null,
    started_at: 10,
    finished_at: null,
    command: 'pnpm dev --actual',
    log_path: '/tmp/web.log',
    trigger: 'manual',
  }
  launcherStore.runningAppIds = new Set(['web-1'])
  launcherStore.runningPids = new Map([['web-1', 4321]])
  launcherStore.latestRuns = new Map([['web-1', activeRun]])
  launcherStore.recentRuns = [activeRun]

  return mount(RunningAppCard, {
    attachTo: document.body,
    props: {
      app: webApp,
      faviconUrl: 'http://localhost:3000/favicon.png',
    },
  })
}

describe('RunningAppCard', () => {
  it('shows runtime command and log preview below a running app', async () => {
    setupTauriMocks({
      logs: { 'web-1': ['ready on 3000'] },
    })
    const wrapper = mountRunningCard()
    await flushPromises()
    const logPreview = wrapper.find('.overflow-x-auto')

    expect(wrapper.text()).toContain('PID 4321')
    expect(wrapper.text()).toContain('pnpm dev --actual')
    expect(wrapper.text()).toContain('日志')
    expect(wrapper.text()).toContain('查看全部')
    expect(wrapper.text()).toContain('ready on 3000')
    expect(logPreview.classes()).toContain('overflow-x-auto')
    expect(logPreview.find('.whitespace-pre').exists()).toBe(true)

    wrapper.unmount()
  })

  it('does not duplicate runtime actions from the sidebar', async () => {
    setupTauriMocks({
      logs: { 'web-1': ['ready'] },
    })
    const wrapper = mountRunningCard()
    await flushPromises()

    expect(wrapper.find('button[aria-label="打开窗口"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="查看日志"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="停止"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('opens the full log dialog from the preview header', async () => {
    setupTauriMocks({
      logs: { 'web-1': ['ready'] },
    })
    const wrapper = mountRunningCard()
    const sessionStore = useAppSessionStore()
    const openExistingLogDialog = vi.spyOn(sessionStore, 'openExistingLogDialog').mockResolvedValue()
    await flushPromises()

    await wrapper.get('button[aria-label="查看全部日志：demo-web"]').trigger('click')

    expect(openExistingLogDialog).toHaveBeenCalledWith(expect.objectContaining({ id: 'web-1' }), 'run-web-active')
    wrapper.unmount()
  })
})
