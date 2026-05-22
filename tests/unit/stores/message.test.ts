import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { getErrorMessage } from '@/lib/error'
import { useMessageStore } from '@/stores/message'

describe('message store', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the latest four messages and auto-dismisses them', () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const api = useMessageStore()
    const { messages } = storeToRefs(api)
    mount(defineComponent({ setup: () => () => h('div') }))

    api.showMessage('one', 'success')
    api.showMessage('two', 'info')
    api.showMessage('three', 'success')
    api.showMessage('four', 'info')
    api.showMessage('five', 'success')

    expect(messages.value.map(item => item.text)).toEqual(['two', 'three', 'four', 'five'])

    vi.advanceTimersByTime(3_500)

    expect(messages.value).toEqual([])
  })

  it('keeps error messages visible longer than success messages', () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const api = useMessageStore()
    const { messages } = storeToRefs(api)
    mount(defineComponent({ setup: () => () => h('div') }))

    api.showMessage('saved', 'success')
    api.showMessage('failed', 'error')

    vi.advanceTimersByTime(3_500)
    expect(messages.value.map(item => item.text)).toEqual(['failed'])

    vi.advanceTimersByTime(4_500)
    expect(messages.value).toEqual([])
  })

  it('dismisses individual messages and formats unknown errors', () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const api = useMessageStore()
    const { messages } = storeToRefs(api)
    mount(defineComponent({ setup: () => () => h('div') }))

    api.showMessage('pending')
    api.dismissMessage(messages.value[0].id)
    vi.advanceTimersByTime(3_500)

    expect(messages.value).toHaveLength(0)
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
    expect(getErrorMessage('plain')).toBe('plain')
  })
})
