import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppCapabilityStack from '@/components/app/capabilities/AppCapabilityStack.vue'
import CronSchedulePicker from '@/components/schedule/CronSchedulePicker.vue'
import { taskApp, webApp } from '../../../../fixtures/apps'

describe('AppCapabilityStack', () => {
  it('renders only the capabilities enabled for the current type', () => {
    const wrapper = mount(AppCapabilityStack, {
      attachTo: document.body,
      props: {
        modelValue: { ...webApp, schedule: { ...webApp.schedule } },
      },
    })

    const ids = wrapper.findAll('[data-capability-id]').map(item => item.attributes('data-capability-id'))
    expect(ids).toEqual(['type-target', 'web-url', 'command', 'working-directory', 'startup', 'window-size', 'name'])
    expect(wrapper.text()).toContain('目标 URL')
    expect(wrapper.text()).not.toContain('定时执行')
    expect(wrapper.text()).not.toContain('运行参数')
  })

  it('forwards task capability events', async () => {
    const wrapper = mount(AppCapabilityStack, {
      attachTo: document.body,
      props: {
        modelValue: { ...taskApp, schedule: { ...taskApp.schedule } },
      },
    })

    const ids = wrapper.findAll('[data-capability-id]').map(item => item.attributes('data-capability-id'))
    expect(ids).toEqual(['type-target', 'command', 'working-directory', 'startup', 'schedule', 'retry', 'name'])

    await wrapper.getComponent(CronSchedulePicker).vm.$emit('update:modelValue', '*/5 * * * *')
    await wrapper.get('button[aria-label="选择工作目录"]').trigger('click')

    expect(wrapper.emitted('setScheduleCron')).toEqual([['*/5 * * * *']])
    expect(wrapper.emitted('chooseWorkingDirectory')).toHaveLength(1)
  })

  it('renders command parameter capability for templated commands', () => {
    const wrapper = mount(AppCapabilityStack, {
      attachTo: document.body,
      props: {
        modelValue: {
          ...taskApp,
          command: 'echo {name=world : 名称} {--debug}',
          profiles: [{ id: 'profile-1', name: 'Demo', values: { name: 'codex' } }],
          schedule: { ...taskApp.schedule },
        },
      },
    })

    const ids = wrapper.findAll('[data-capability-id]').map(item => item.attributes('data-capability-id'))
    expect(ids).toEqual(['type-target', 'command', 'command-parameters', 'working-directory', 'startup', 'schedule', 'retry', 'name'])
    expect(wrapper.text()).toContain('运行参数')
    expect(wrapper.text()).toContain('2 个参数')
    expect(wrapper.text()).toContain('1 个方案')
  })
})
