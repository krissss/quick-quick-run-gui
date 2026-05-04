import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TypeTargetCapability from '@/components/app/capabilities/TypeTargetCapability.vue'
import { webApp } from '../../../../fixtures/apps'
import { buttonContaining } from '../../../../helpers/dom'

describe('TypeTargetCapability', () => {
  it('keeps type target guidance compact and emits selection changes', async () => {
    const wrapper = mount(TypeTargetCapability, {
      attachTo: document.body,
      props: {
        modelValue: { ...webApp, schedule: { ...webApp.schedule } },
      },
    })

    expect(wrapper.get('button[aria-label="查看类型目标说明"]').exists()).toBe(true)
    expect(wrapper.get('button[value="web"]').attributes('title')).toContain('打开一个 Web 界面')
    expect(wrapper.get('button[value="service"]').attributes('title')).toContain('托管长期运行的后台进程')
    expect(wrapper.get('button[value="task"]').attributes('title')).toContain('执行一次命令')
    expect(wrapper.text()).not.toContain('类型目标')

    await buttonContaining(wrapper, '服务', true).trigger('click')

    expect(wrapper.emitted('setType')).toEqual([['service']])
  })
})
