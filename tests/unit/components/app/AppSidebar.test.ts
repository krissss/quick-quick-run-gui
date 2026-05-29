import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppSidebar from '@/components/app/AppSidebar.vue'
import { useAppsStore } from '@/stores/apps'
import { useAppCatalogStore } from '@/stores/apps/appCatalog'
import { useAppSessionStore } from '@/stores/appSession'
import { useLauncherStore } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import type { AppItem } from '@/lib/store'
import { serviceApp, serviceFailedRun, taskApp, webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder, visibleAppIds } from '../../../helpers/dom'

function mountSidebar(options: {
  selectedAppId?: string
  isNew?: boolean
  runningAppIds?: Set<string>
  latestRuns?: Map<string, typeof serviceFailedRun>
  pendingLaunches?: Map<string, never>
  faviconUrl?: (appId: string) => string
  apps?: AppItem[]
} = {}) {
  const appsStore = useAppsStore()
  const launcherStore = useLauncherStore()
  appsStore.apps = options.apps ?? [webApp, serviceApp, taskApp]
  appsStore.isNew = options.isNew ?? false
  if (options.selectedAppId) {
    const selectedApp = appsStore.apps.find(app => app.id === options.selectedAppId)
    if (selectedApp) appsStore.selectApp(selectedApp)
  }
  launcherStore.runningAppIds = options.runningAppIds ?? new Set()
  launcherStore.latestRuns = options.latestRuns ?? new Map()
  launcherStore.pendingLaunches = options.pendingLaunches ?? new Map()

  return mount(AppSidebar, {
    attachTo: document.body,
    props: {
      faviconUrl: (app) => options.faviconUrl?.(app.id) ?? (app.id === 'web-1' ? 'http://localhost:3000/favicon.png' : ''),
    },
  })
}

function appRow(wrapper: ReturnType<typeof mountSidebar>, appId: string) {
  const row = wrapper.find(`[data-app-id="${appId}"]`)
  if (!row.exists()) throw new Error(`App row not found: ${appId}`)
  return row
}

describe('AppSidebar', () => {
  it('renders one ordered list, filters by search/type, and emits navigation actions', async () => {
    const wrapper = mountSidebar({
      selectedAppId: 'web-1',
      runningAppIds: new Set(['web-1']),
      latestRuns: new Map([['service-1', serviceFailedRun]]),
    })

    expect(wrapper.text()).toContain('demo-web')
    expect(wrapper.text()).toContain('worker')
    expect(wrapper.text()).toContain('daily')
    expect(visibleAppIds()).toEqual(['web-1', 'service-1', 'task-1'])
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.text()).toContain('失败')
    expect(appRow(wrapper, 'web-1').text()).toContain('网页')
    expect(appRow(wrapper, 'web-1').text()).toContain('运行中')
    expect(appRow(wrapper, 'web-1').text()).toContain('localhost:3000')
    await flushPromises()
    expect(appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').attributes('src')).toBe('http://localhost:3000/favicon.png')
    expect(appRow(wrapper, 'service-1').text()).toContain('失败')
    expect(appRow(wrapper, 'service-1').text()).toContain('pnpm worker')

    await inputByPlaceholder(wrapper, '搜索名称、命令或 URL').setValue('worker')
    expect(visibleAppIds()).toEqual(['service-1'])

    await wrapper.get('button[aria-label="清空搜索"]').trigger('click')
    await wrapper.get('button[aria-label="筛选任务"]').trigger('click')
    expect(visibleAppIds()).toEqual(['task-1'])

    await wrapper.get('button[aria-label="添加应用"]').trigger('click')
    await buttonContaining(wrapper, '设置').trigger('click')
    await appRow(wrapper, 'task-1').trigger('click')

    const appsStore = useAppsStore()
    expect(appsStore.isNew).toBe(false)
    expect(appsStore.editForm.id).toBe('task-1')
  })

  it('keeps search and type filters on one toolbar row', () => {
    const wrapper = mountSidebar()

    expect(wrapper.get('input[aria-label="搜索应用"]').exists()).toBe(true)
    expect(wrapper.get('button[aria-label="显示全部"]').exists()).toBe(true)
    expect(wrapper.get('button[aria-label="筛选网页"]').exists()).toBe(true)
    expect(wrapper.get('button[aria-label="筛选服务"]').exists()).toBe(true)
    expect(wrapper.get('button[aria-label="筛选任务"]').exists()).toBe(true)
  })

  it('does not show a stale running run as active when backend running state is missing', () => {
    const wrapper = mountSidebar({
      latestRuns: new Map([[
        'web-1',
        {
          ...serviceFailedRun,
          id: 'run-web',
          app_id: 'web-1',
          app_name: 'demo-web',
          item_type: 'web',
          status: 'running',
          pid: 4321,
        },
      ]]),
    })

    expect(appRow(wrapper, 'web-1').text()).toContain('状态待确认')
    expect(appRow(wrapper, 'web-1').text()).not.toContain('运行中')
  })

  it('exposes grouped row actions and opens the editor on double click', async () => {
    const wrapper = mountSidebar({
      selectedAppId: 'web-1',
      runningAppIds: new Set(['web-1']),
    })
    const launcherStore = useLauncherStore()
    const logsStore = useLogsStore()
    const sessionStore = useAppSessionStore()
    const showAppWindow = vi.spyOn(launcherStore, 'showAppWindow').mockResolvedValue()
    const stopApp = vi.spyOn(launcherStore, 'stopApp').mockResolvedValue()
    const openLogDialog = vi.spyOn(logsStore, 'openLogDialog').mockResolvedValue()
    const openEditor = vi.spyOn(sessionStore, 'openEditor').mockResolvedValue()
    const selectApp = vi.spyOn(sessionStore, 'selectApp').mockResolvedValue()

    expect(wrapper.find('button[aria-label="更多操作：demo-web"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="打开窗口：demo-web"]').trigger('click')
    await wrapper.get('button[aria-label="打开窗口：demo-web"]').trigger('keydown', { key: 'Enter' })
    await wrapper.get('button[aria-label="查看日志：demo-web"]').trigger('click')
    await wrapper.get('button[aria-label="停止：demo-web"]').trigger('click')
    expect(wrapper.find('button[aria-label="复制：demo-web"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="删除：demo-web"]').exists()).toBe(false)
    await appRow(wrapper, 'web-1').trigger('dblclick')

    expect(showAppWindow).toHaveBeenCalledWith('web-1')
    expect(selectApp).not.toHaveBeenCalled()
    expect(openLogDialog).toHaveBeenCalledWith(expect.objectContaining({ id: 'web-1' }), true, undefined)
    expect(stopApp).toHaveBeenCalledWith('web-1')
    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ id: 'web-1' }))
  })

  it('keeps delayed launch available from each list row', async () => {
    const wrapper = mountSidebar()
    const sessionStore = useAppSessionStore()
    const requestLaunch = vi.spyOn(sessionStore, 'requestLaunch').mockResolvedValue()

    await wrapper.get('button[aria-label="延迟运行：daily"]').trigger('click')
    await buttonContaining(wrapper, '1 分钟').trigger('click')

    expect(requestLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }), { delaySeconds: 60 })
  })

  it('runs the active profile directly for templated commands while keeping parameter launch available', async () => {
    const templatedTask: AppItem = {
      ...taskApp,
      command: 'pnpm daily {account=demo : 账号} {--headless}',
      activeProfileId: 'profile-1',
      profiles: [
        { id: 'profile-1', name: '账号 1', values: { account: 'alice', headless: 'true' } },
      ],
    }
    const wrapper = mountSidebar({
      apps: [webApp, serviceApp, templatedTask],
    })
    const sessionStore = useAppSessionStore()
    const launcherStore = useLauncherStore()
    const requestLaunch = vi.spyOn(sessionStore, 'requestLaunch').mockResolvedValue()
    const launchApp = vi.spyOn(launcherStore, 'launchApp').mockResolvedValue()

    await wrapper.get('button[aria-label="运行：daily"]').trigger('click')
    expect(requestLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }), {})
    expect(launchApp).not.toHaveBeenCalled()
    expect(appRow(wrapper, 'task-1').text()).toContain('方案：账号 1')

    await wrapper.get('button[aria-label="立即运行当前方案：daily"]').trigger('click')
    expect(launchApp).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      activeProfileId: 'profile-1',
    }))
  })

  it('emits reorder after dragging a list item', async () => {
    const wrapper = mountSidebar()
    vi.spyOn(useAppCatalogStore(), 'persistApps').mockResolvedValue()
    const taskRow = appRow(wrapper, 'task-1')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => appRow(wrapper, 'web-1').element),
    })

    expect(taskRow.classes()).not.toContain('cursor-grab')
    expect(wrapper.find('[data-testid="drag-handle-task-1"]').exists()).toBe(false)
    await taskRow.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await taskRow.trigger('pointermove', { pointerId: 1, clientX: 10, clientY: 20 })
    await taskRow.trigger('pointerup', { pointerId: 1, clientX: 10, clientY: 20 })
    await flushPromises()

    expect(useAppsStore().apps.map(app => app.id)).toEqual(['web-1', 'service-1', 'task-1'])

    await wrapper.get('button[aria-label="整理排序"]').trigger('click')
    const taskDragHandle = wrapper.get('[data-testid="drag-handle-task-1"]')

    await taskDragHandle.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await taskRow.trigger('pointermove', { pointerId: 1, clientX: 10, clientY: 20 })
    await taskRow.trigger('pointerup', { pointerId: 1, clientX: 10, clientY: 20 })
    await flushPromises()

    expect(useAppsStore().apps.map(app => app.id)).toEqual(['task-1', 'web-1', 'service-1'])

    await wrapper.get('button[aria-label="完成整理"]').trigger('click')
    expect(wrapper.find('[data-testid="drag-handle-task-1"]').exists()).toBe(false)
  })

  it('emits favicon errors for the shared icon state owner', async () => {
    const wrapper = mountSidebar()

    await flushPromises()
    await appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').trigger('error')

    expect(wrapper.emitted('favicon-error')).toEqual([[webApp]])
  })
})
