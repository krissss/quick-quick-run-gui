import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppDetailForm from '@/components/app/AppDetailForm.vue'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore } from '@/stores/launcher'
import { serviceApp, taskApp, taskSuccessRun, webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder } from '../../../helpers/dom'

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
  it('renders pure editing header without runtime controls', async () => {
    const wrapper = mountDetail()

    expect(wrapper.text()).not.toContain('网页配置')
    expect(wrapper.find('img[alt="demo-web favicon"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('PID 4321')
    expect(wrapper.text()).not.toContain('日志')
    expect(wrapper.find('button[aria-label="打开窗口"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="查看日志"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="停止"]').exists()).toBe(false)
    expect(wrapper.get('button[aria-label="查看类型目标说明"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('类型目标')
  })

  it('does not show pending delayed launch controls in the editor', async () => {
    const wrapper = mountDetail(webApp, { pending: true, running: false })

    expect(wrapper.text()).not.toContain('停止启动')
  })

  it('shows restart for running services but not running tasks', () => {
    const serviceWrapper = mountDetail(serviceApp, { running: true })
    const taskWrapper = mountDetail(taskApp, { running: true })

    expect(buttonContaining(serviceWrapper, '保存', true).exists()).toBe(true)
    expect(serviceWrapper.find('button[aria-label="重启"]').exists()).toBe(false)
    expect(taskWrapper.find('button[aria-label="重启"]').exists()).toBe(false)
  })

  it('confirms before deleting the current app', async () => {
    const wrapper = mountDetail()
    const appsStore = useAppsStore()
    vi.spyOn(appsStore, 'deleteApp').mockResolvedValue()

    await buttonContaining(wrapper, '删除', true).trigger('click')
    await flushPromises()

    expect(appsStore.deleteApp).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('确认删除应用')
    expect(document.body.textContent).toContain('将删除「demo-web」')

    await buttonContaining(wrapper, '确认删除', true).trigger('click')
    await flushPromises()

    expect(appsStore.deleteApp).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('确认删除应用')
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
