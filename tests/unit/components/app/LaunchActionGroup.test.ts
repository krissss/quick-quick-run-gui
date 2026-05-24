import { DOMWrapper, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LaunchActionGroup from '@/components/app/LaunchActionGroup.vue'

function bodyButton(text: string) {
  const element = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === text)
  if (!element) throw new Error(`Button not found: ${text}`)
  return new DOMWrapper(element)
}

function delayMenu() {
  const element = document.querySelector('[data-testid="launch-delay-menu"]')
  if (!element) throw new Error('Delay menu not found')
  return new DOMWrapper(element as HTMLElement)
}

function customDelayInput() {
  const element = document.querySelector('input[aria-label="自定义延迟秒数"]')
  if (!element) throw new Error('Custom delay input not found')
  return new DOMWrapper(element as HTMLInputElement)
}

describe('LaunchActionGroup', () => {
  it('emits immediate and preset delayed launch requests', async () => {
    const wrapper = mount(LaunchActionGroup, {
      attachTo: document.body,
      props: { label: '启动' },
    })

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('launch')).toEqual([[]])

    await wrapper.get('button[aria-label="延迟运行"]').trigger('click')
    const menu = delayMenu()
    expect(menu.element.parentElement).toBe(document.body)
    expect((menu.element as HTMLElement).style.position).toBe('fixed')
    await bodyButton('1 分钟').trigger('click')

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
    await customDelayInput().setValue('20')
    await bodyButton('秒后').trigger('click')

    expect(wrapper.emitted('launch')?.at(-1)).toEqual([20])
  })

  it('closes the delay popover when clicking outside or pressing escape', async () => {
    const wrapper = mount(LaunchActionGroup, {
      attachTo: document.body,
      props: { label: '启动' },
    })

    await wrapper.get('button[aria-label="延迟运行"]').trigger('click')
    expect(document.body.textContent).toContain('延迟运行')

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('[data-testid="launch-delay-menu"]')).toBeNull()

    await wrapper.get('button[aria-label="延迟运行"]').trigger('click')
    expect(document.body.textContent).toContain('延迟运行')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('[data-testid="launch-delay-menu"]')).toBeNull()
  })

  it('supports an icon-only row variant for quick list actions', async () => {
    const wrapper = mount(LaunchActionGroup, {
      attachTo: document.body,
      props: { label: '运行：daily', size: 'row' },
    })

    expect(wrapper.get('button[aria-label="运行：daily"]').text()).toBe('')
    await wrapper.get('button[aria-label="运行：daily"]').trigger('click')
    expect(wrapper.emitted('launch')).toEqual([[]])

    await wrapper.get('button[aria-label="延迟运行：daily"]').trigger('click')
    const menu = delayMenu()
    expect(menu.element.parentElement).toBe(document.body)
    await bodyButton('1 分钟').trigger('click')

    expect(wrapper.emitted('launch')?.at(-1)).toEqual([60])
  })
})
