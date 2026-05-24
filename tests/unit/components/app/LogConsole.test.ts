import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LogConsole from '@/components/app/LogConsole.vue'

describe('LogConsole', () => {
  it('renders log lines in a black console with horizontal scrolling', () => {
    const wrapper = mount(LogConsole, {
      props: {
        lines: ['ready', 'long command output'],
      },
    })

    expect(wrapper.classes()).toContain('bg-[#1e1e2e]')
    expect(wrapper.classes()).toContain('overflow-x-auto')
    expect(wrapper.text()).toContain('ready')
    expect(wrapper.find('.whitespace-pre').exists()).toBe(true)
  })

  it('uses the dialog sizing variant and exposes scroll to bottom', async () => {
    const wrapper = mount(LogConsole, {
      props: {
        lines: [],
        size: 'dialog',
      },
    })

    const element = wrapper.element as HTMLElement
    Object.defineProperty(element, 'scrollHeight', {
      configurable: true,
      value: 240,
    })
    await wrapper.vm.scrollToBottom()

    expect(wrapper.classes()).toContain('overflow-auto')
    expect(wrapper.text()).toContain('暂无日志')
    expect(element.scrollTop).toBe(240)
  })
})
