import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppSidebar from '@/components/app/AppSidebar.vue'
import { serviceApp, serviceFailedRun, taskApp, webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder, visibleAppIds } from '../../../helpers/dom'
import { setupTauriMocks } from '../../../helpers/tauri'

function mountSidebar(options: {
  selectedAppId?: string
  isNew?: boolean
  runningAppIds?: Set<string>
  latestRuns?: Map<string, typeof serviceFailedRun>
  faviconResolver?: (url: string) => string | null
} = {}) {
  setupTauriMocks({
    favicons: {
      [webApp.url]: 'http://localhost:3000/favicon.png',
    },
    faviconResolver: options.faviconResolver,
  })
  return mount(AppSidebar, {
    attachTo: document.body,
    props: {
      apps: [webApp, serviceApp, taskApp],
      selectedAppId: options.selectedAppId ?? '',
      isNew: options.isNew ?? false,
      runningAppIds: options.runningAppIds ?? new Set(),
      latestRuns: options.latestRuns ?? new Map(),
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
    expect(wrapper.text()).toContain('上次失败')
    expect(appRow(wrapper, 'web-1').text()).not.toContain('网页')
    expect(appRow(wrapper, 'web-1').text()).toContain('运行中')
    expect(appRow(wrapper, 'web-1').text()).toContain('localhost:3000')
    await flushPromises()
    expect(appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').attributes('src')).toBe('http://localhost:3000/favicon.png')
    expect(appRow(wrapper, 'service-1').text()).toContain('上次失败')
    expect(appRow(wrapper, 'service-1').text()).toContain('pnpm worker')

    await inputByPlaceholder(wrapper, '搜索名称、命令或 URL').setValue('worker')
    expect(visibleAppIds()).toEqual(['service-1'])

    await wrapper.get('button[aria-label="清空搜索"]').trigger('click')
    await wrapper.get('button[aria-label="筛选任务"]').trigger('click')
    expect(visibleAppIds()).toEqual(['task-1'])

    await buttonContaining(wrapper, '添加应用').trigger('click')
    await buttonContaining(wrapper, '设置').trigger('click')
    await appRow(wrapper, 'task-1').trigger('click')

    expect(wrapper.emitted('add')).toHaveLength(1)
    expect(wrapper.emitted('openSettings')).toHaveLength(1)
    expect(wrapper.emitted('select')?.[0]).toEqual([taskApp])
  })

  it('emits reorder after dragging a list item', async () => {
    const wrapper = mountSidebar()
    const taskRow = appRow(wrapper, 'task-1')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => appRow(wrapper, 'web-1').element),
    })

    await taskRow.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await taskRow.trigger('pointermove', { pointerId: 1, clientX: 10, clientY: 20 })
    await taskRow.trigger('pointerup', { pointerId: 1, clientX: 10, clientY: 20 })

    expect(wrapper.emitted('reorder')).toEqual([['task-1', 'web-1']])
  })

  it('retries web favicon after the app becomes running', async () => {
    vi.useFakeTimers()
    let ready = false
    const wrapper = mountSidebar({
      runningAppIds: new Set(),
      faviconResolver: () => ready ? 'http://localhost:3000/ready-icon.png' : null,
    })

    await flushPromises()
    expect(appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').exists()).toBe(true)

    await appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').trigger('error')
    expect(appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').exists()).toBe(false)

    ready = true
    await wrapper.setProps({ runningAppIds: new Set(['web-1']) })
    await flushPromises()

    expect(appRow(wrapper, 'web-1').find('img[alt="demo-web favicon"]').attributes('src')).toBe('http://localhost:3000/ready-icon.png')

    wrapper.unmount()
    vi.useRealTimers()
  })
})
