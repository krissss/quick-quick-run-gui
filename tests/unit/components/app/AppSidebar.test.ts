import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppSidebar from '@/components/app/AppSidebar.vue'
import { serviceApp, serviceFailedRun, taskApp, webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder, visibleAppIds } from '../../../helpers/dom'

function mountSidebar(options: {
  selectedAppId?: string
  isNew?: boolean
  runningAppIds?: Set<string>
  latestRuns?: Map<string, typeof serviceFailedRun>
} = {}) {
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
  it('groups apps, filters by search/type, and emits navigation actions', async () => {
    const wrapper = mountSidebar({
      selectedAppId: 'web-1',
      runningAppIds: new Set(['web-1']),
      latestRuns: new Map([['service-1', serviceFailedRun]]),
    })

    expect(wrapper.text()).toContain('网页1')
    expect(wrapper.text()).toContain('服务1')
    expect(wrapper.text()).toContain('任务1')
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.text()).toContain('上次失败')

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
})
