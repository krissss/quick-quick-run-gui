import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LaunchActionGroup from '@/components/app/LaunchActionGroup.vue'

describe('LaunchActionGroup', () => {
  it('emits immediate and preset delayed launch requests', async () => {
    const wrapper = mount(LaunchActionGroup, {
      attachTo: document.body,
      props: { label: '启动' },
    })

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('launch')).toEqual([[]])

    await wrapper.get('button[aria-label="延迟运行"]').trigger('click')
    const preset = wrapper.findAll('button').find(button => button.text() === '1 分钟')
    if (!preset) throw new Error('1 minute preset not found')
    await preset.trigger('click')

    expect(wrapper.emitted('launch')?.at(-1)).toEqual([60])
  })

  it('uses the default delay for the primary action and supports custom seconds', async () => {
    const wrapper = mount(LaunchActionGroup, {
      attachTo: document.body,
      props: { label: '运行', defaultDelaySeconds: 90 },
    })

    expect(wrapper.text()).toContain('1 分 30 秒后运行')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('launch')?.at(-1)).toEqual([90])

    await wrapper.get('button[aria-label="延迟运行"]').trigger('click')
    await wrapper.get('input[aria-label="自定义延迟秒数"]').setValue('20')
    const customButton = wrapper.findAll('button').find(button => button.text() === '秒后')
    if (!customButton) throw new Error('Custom delay button not found')
    await customButton.trigger('click')

    expect(wrapper.emitted('launch')?.at(-1)).toEqual([20])
  })

  it('closes the delay popover when clicking outside or pressing escape', async () => {
    const wrapper = mount(LaunchActionGroup, {
      attachTo: document.body,
      props: { label: '启动' },
    })

    await wrapper.get('button[aria-label="延迟运行"]').trigger('click')
    expect(wrapper.text()).toContain('延迟运行')

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('延迟运行')

    await wrapper.get('button[aria-label="延迟运行"]').trigger('click')
    expect(wrapper.text()).toContain('延迟运行')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('延迟运行')
  })
})
