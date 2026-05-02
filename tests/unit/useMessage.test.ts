import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getErrorMessage, useMessage } from '@/composables/useMessage'

describe('useMessage', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the latest four messages and auto-dismisses them', () => {
    vi.useFakeTimers()
    let api!: ReturnType<typeof useMessage>
    mount(defineComponent({
      setup() {
        api = useMessage()
        return () => h('div')
      },
    }))

    api.showMessage('one', 'success')
    api.showMessage('two', 'info')
    api.showMessage('three', 'success')
    api.showMessage('four', 'info')
    api.showMessage('five', 'success')

    expect(api.messages.value.map((item) => item.text)).toEqual(['two', 'three', 'four', 'five'])

    vi.advanceTimersByTime(3_500)

    expect(api.messages.value).toEqual([])
  })

  it('keeps error messages visible longer than success messages', () => {
    vi.useFakeTimers()
    let api!: ReturnType<typeof useMessage>
    mount(defineComponent({
      setup() {
        api = useMessage()
        return () => h('div')
      },
    }))

    api.showMessage('saved', 'success')
    api.showMessage('failed', 'error')

    vi.advanceTimersByTime(3_500)
    expect(api.messages.value.map((item) => item.text)).toEqual(['failed'])

    vi.advanceTimersByTime(4_500)
    expect(api.messages.value).toEqual([])
  })

  it('clears timers on unmount and formats unknown errors', () => {
    vi.useFakeTimers()
    let api!: ReturnType<typeof useMessage>
    const wrapper = mount(defineComponent({
      setup() {
        api = useMessage()
        return () => h('div')
      },
    }))

    api.showMessage('pending')
    api.dismissMessage(999)
    wrapper.unmount()
    vi.advanceTimersByTime(3_500)

    expect(api.messages.value).toHaveLength(1)
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
    expect(getErrorMessage('plain')).toBe('plain')
  })
})
