import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppSidebar from '@/components/app/AppSidebar.vue'
import { useAppsStore } from '@/stores/apps'
import { useAppCatalogStore } from '@/stores/apps/appCatalog'
import { useLauncherStore } from '@/stores/launcher'
import { serviceApp, serviceFailedRun, taskApp, webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder, visibleAppIds } from '../../../helpers/dom'

function mountSidebar(options: {
  selectedAppId?: string
  isNew?: boolean
  runningAppIds?: Set<string>
  latestRuns?: Map<string, typeof serviceFailedRun>
  pendingLaunches?: Map<string, never>
  faviconUrl?: (appId: string) => string
} = {}) {
  const appsStore = useAppsStore()
  const launcherStore = useLauncherStore()
  appsStore.apps = [webApp, serviceApp, taskApp]
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
    expect(appRow(wrapper, 'web-1').text()).not.toContain('网页')
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

  it('emits reorder after dragging a list item', async () => {
    const wrapper = mountSidebar()
    vi.spyOn(useAppCatalogStore(), 'persistApps').mockResolvedValue()
    const taskRow = appRow(wrapper, 'task-1')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => appRow(wrapper, 'web-1').element),
    })

    await taskRow.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await taskRow.trigger('pointermove', { pointerId: 1, clientX: 10, clientY: 20 })
    await taskRow.trigger('pointerup', { pointerId: 1, clientX: 10, clientY: 20 })
    await flushPromises()

    expect(useAppsStore().apps.map(app => app.id)).toEqual(['task-1', 'web-1', 'service-1'])
  })

  it('emits favicon errors for the shared icon state owner', async () => {
    const wrapper = mountSidebar()

    await flushPromises()
    await appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').trigger('error')

    expect(wrapper.emitted('favicon-error')).toEqual([[webApp]])
  })
})
