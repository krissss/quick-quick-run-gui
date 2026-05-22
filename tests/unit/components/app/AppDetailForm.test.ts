import { flushPromises, mount, DOMWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppDetailForm from '@/components/app/AppDetailForm.vue'
import { useAppsStore } from '@/stores/apps'
import { useAppCatalogStore } from '@/stores/apps/appCatalog'
import { useLauncherStore } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import { serviceApp, taskApp, taskSuccessRun, webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder } from '../../../helpers/dom'
import { setupTauriMocks } from '../../../helpers/tauri'

function mountDetail(app = webApp, options: { isNew?: boolean; pending?: boolean; running?: boolean } = {}) {
  const running = options.running ?? app.id === 'web-1'
  const appsStore = useAppsStore()
  const launcherStore = useLauncherStore()
  appsStore.editForm = { ...app, schedule: { ...app.schedule }, profiles: [...app.profiles] }
  appsStore.isNew = options.isNew ?? false
  appsStore.resetEditSnapshot()
  launcherStore.runningAppIds = new Set(running ? [app.id] : [])
  launcherStore.runningPids = new Map(running ? [[app.id, 4321]] : [])
  launcherStore.latestRuns = new Map([['task-1', taskSuccessRun]])
  launcherStore.pendingLaunches = new Map(options.pending ? [[app.id, {
    appId: app.id,
    appName: app.name,
    delaySeconds: 60,
    runAt: Date.UTC(2026, 4, 4, 6, 30, 0),
  }]] : [])
  launcherStore.restartingAppIds = new Set()

  return mount(AppDetailForm, {
    attachTo: document.body,
  })
}

describe('AppDetailForm', () => {
  it('renders running controls and emits detail actions', async () => {
    const wrapper = mountDetail()

    expect(wrapper.text()).toContain('PID 4321')
    expect(wrapper.get('button[aria-label="查看类型目标说明"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('类型目标')
    const launcherStore = useLauncherStore()
    const logsStore = useLogsStore()
    const showAppWindow = vi.spyOn(launcherStore, 'showAppWindow').mockResolvedValue()
    const openLogDialog = vi.spyOn(logsStore, 'openLogDialog').mockResolvedValue()
    const restartApp = vi.spyOn(launcherStore, 'restartApp').mockResolvedValue()
    const stopApp = vi.spyOn(launcherStore, 'stopApp').mockResolvedValue()
    vi.spyOn(useAppCatalogStore(), 'persistApps').mockResolvedValue()
    await buttonContaining(wrapper, '窗口').trigger('click')
    await buttonContaining(wrapper, '日志').trigger('click')
    await buttonContaining(wrapper, '重启').trigger('click')
    await buttonContaining(wrapper, '停止').trigger('click')
    await buttonContaining(wrapper, '复制').trigger('click')
    await buttonContaining(wrapper, '删除').trigger('click')

    expect(showAppWindow).toHaveBeenCalledWith('web-1')
    expect(openLogDialog).toHaveBeenCalledWith(expect.objectContaining({ id: 'web-1' }), true)
    expect(restartApp).toHaveBeenCalledWith(expect.objectContaining({ id: 'web-1' }))
    expect(stopApp).toHaveBeenCalledWith('web-1')
    expect(useAppsStore().isNew).toBe(true)
    expect(useAppsStore().editForm.id).toBe('')
  })

  it('shows pending delayed launch state and emits cancellation', async () => {
    const wrapper = mountDetail(webApp, { pending: true, running: false })

    expect(wrapper.text()).toContain('停止启动')
    const cancelDelayedLaunch = vi.spyOn(useLauncherStore(), 'cancelDelayedLaunch').mockImplementation(() => {})
    await buttonContaining(wrapper, '停止启动').trigger('click')

    expect(cancelDelayedLaunch).toHaveBeenCalledWith('web-1')
  })

  it('shows restart for running services but not running tasks', () => {
    const serviceWrapper = mountDetail(serviceApp, { running: true })
    const taskWrapper = mountDetail(taskApp, { running: true })

    expect(serviceWrapper.text()).toContain('重启')
    expect(taskWrapper.text()).not.toContain('重启')
  })

  it('keeps the running log preview visible after clearing the command draft', async () => {
    setupTauriMocks({
      logs: { 'web-1': ['ready on 3000'] },
    })
    const wrapper = mountDetail(webApp, { running: true })
    await flushPromises()

    expect(wrapper.text()).toContain('ready on 3000')

    const commandInput = inputByPlaceholder(wrapper, 'npm run dev')
    const commandInputGroup = new DOMWrapper(commandInput.element.parentElement as Element)
    await commandInputGroup.get('button[aria-label="清空输入"]').trigger('click')
    await flushPromises()

    expect((commandInput.element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).toContain('ready on 3000')

    wrapper.unmount()
  })

  it('emits form events for type, working directory, schedule, and save', async () => {
    const wrapper = mountDetail(taskApp, { isNew: true })
    const appsStore = useAppsStore()
    vi.spyOn(appsStore, 'saveApp').mockResolvedValue(true)
    vi.spyOn(appsStore, 'setAppType').mockImplementation((type) => {
      appsStore.editForm = { ...appsStore.editForm, type }
    })
    vi.spyOn(appsStore, 'setScheduleCron').mockImplementation((cron) => {
      appsStore.editForm = { ...appsStore.editForm, schedule: { ...appsStore.editForm.schedule, cron } }
    })
    vi.spyOn(appsStore, 'setMissedPolicy').mockImplementation((missedPolicy) => {
      appsStore.editForm = { ...appsStore.editForm, schedule: { ...appsStore.editForm.schedule, missedPolicy } }
    })

    await buttonContaining(wrapper, '网页', true).trigger('click')
    await wrapper.get('button[aria-label="选择工作目录"]').trigger('click')
    appsStore.setScheduleCron('*/10 * * * *')
    appsStore.setMissedPolicy('skip')
    await buttonContaining(wrapper, '添加', true).trigger('click')

    expect(appsStore.editForm.type).toBe('web')
    expect(appsStore.editForm.schedule.cron).toBe('*/10 * * * *')
    expect(appsStore.editForm.schedule.missedPolicy).toBe('skip')
    expect(appsStore.saveApp).toHaveBeenCalledOnce()
  })

  it('shows default name placeholders for new apps', () => {
    const wrapper = mountDetail(serviceApp, { isNew: true })

    expect(inputByPlaceholder(wrapper, 'pnpm worker').exists()).toBe(true)
  })
})
