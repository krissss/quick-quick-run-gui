import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppDetailForm from '@/components/app/AppDetailForm.vue'
import CronSchedulePicker from '@/components/schedule/CronSchedulePicker.vue'
import { serviceApp, taskApp, taskSuccessRun, webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder } from '../../../helpers/dom'

function mountDetail(app = webApp, options: { isNew?: boolean; pending?: boolean } = {}) {
  return mount(AppDetailForm, {
    attachTo: document.body,
    props: {
      modelValue: { ...app, schedule: { ...app.schedule }, profiles: [...app.profiles] },
      isNew: options.isNew ?? false,
      runningAppIds: new Set(app.id === 'web-1' ? ['web-1'] : []),
      runningPids: new Map(app.id === 'web-1' ? [['web-1', 4321]] : []),
      latestRuns: new Map([['task-1', taskSuccessRun]]),
      pendingLaunches: new Map(options.pending ? [[app.id, {
        appId: app.id,
        appName: app.name,
        delaySeconds: 60,
        runAt: Date.UTC(2026, 4, 4, 6, 30, 0),
      }]] : []),
      'onUpdate:modelValue': () => {},
    },
  })
}

describe('AppDetailForm', () => {
  it('renders running controls and emits detail actions', async () => {
    const wrapper = mountDetail()

    expect(wrapper.text()).toContain('PID 4321')
    expect(wrapper.get('button[aria-label="查看类型目标说明"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('类型目标')
    await buttonContaining(wrapper, '窗口').trigger('click')
    await buttonContaining(wrapper, '日志').trigger('click')
    await buttonContaining(wrapper, '停止').trigger('click')
    await buttonContaining(wrapper, '启动', true).trigger('click')
    await buttonContaining(wrapper, '复制').trigger('click')
    await buttonContaining(wrapper, '删除').trigger('click')

    expect(wrapper.emitted('showWindow')).toEqual([['web-1']])
    expect(wrapper.emitted('openLog')).toEqual([[expect.objectContaining({ id: 'web-1' })]])
    expect(wrapper.emitted('stop')).toEqual([['web-1']])
    expect(wrapper.emitted('launch')).toEqual([[expect.objectContaining({ id: 'web-1' })]])
    expect(wrapper.emitted('duplicate')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })

  it('shows pending delayed launch state and emits cancellation', async () => {
    const wrapper = mountDetail(webApp, { pending: true })

    expect(wrapper.text()).toContain('1 分钟后')
    await buttonContaining(wrapper, '取消').trigger('click')

    expect(wrapper.emitted('cancelDelayedLaunch')).toEqual([['web-1']])
  })

  it('emits form events for type, working directory, schedule, and save', async () => {
    const wrapper = mountDetail(taskApp, { isNew: true })

    await buttonContaining(wrapper, '网页', true).trigger('click')
    await wrapper.get('button[aria-label="选择工作目录"]').trigger('click')
    await wrapper.getComponent(CronSchedulePicker).vm.$emit('update:modelValue', '*/10 * * * *')
    await buttonContaining(wrapper, '跳过', true).trigger('click')
    await inputByPlaceholder(wrapper, 'pnpm report').setValue('pnpm report')
    await buttonContaining(wrapper, '添加', true).trigger('click')

    expect(wrapper.emitted('setType')).toEqual([['web']])
    expect(wrapper.emitted('chooseWorkingDirectory')).toHaveLength(1)
    expect(wrapper.emitted('setScheduleCron')).toEqual([['*/10 * * * *']])
    expect(wrapper.emitted('setMissedPolicy')).toEqual([['skip']])
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('shows default name placeholders for new apps', () => {
    const wrapper = mountDetail(serviceApp, { isNew: true })

    expect(inputByPlaceholder(wrapper, 'pnpm worker').exists()).toBe(true)
  })
})
