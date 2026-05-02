import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupTauriMocks } from '../helpers/tauri'

async function mountAppWindow(url = 'http://localhost:3000') {
  vi.resetModules()
  window.history.pushState(null, '', `/?url=${encodeURIComponent(url)}`)
  const mock = setupTauriMocks()
  const { default: AppWindow } = await import('@/AppWindow.vue')
  const wrapper = mount(AppWindow, { attachTo: document.body })
  return { mock, wrapper, url }
}

describe('AppWindow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows loading, handles iframe load, reloads, and opens the target URL in the browser', async () => {
    vi.useFakeTimers()
    const { mock, wrapper, url } = await mountAppWindow()

    expect(wrapper.text()).toContain('加载中...')

    const iframe = wrapper.get('iframe')
    expect(iframe.attributes('src')).toBe(url)

    await iframe.trigger('load')
    expect(wrapper.text()).not.toContain('加载中...')

    await wrapper.get('button[title="在浏览器中打开"]').trigger('click')
    expect(mock.getCalls('open_in_browser')[0].payload).toEqual({ url })

    await wrapper.get('button[title="刷新页面"]').trigger('click')
    await vi.advanceTimersByTimeAsync(100)
    expect(iframe.attributes('src')).toBe(url)
  })

  it('retries iframe errors before showing the error state and allows manual retry', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountAppWindow('http://localhost:4000')
    const iframe = wrapper.get('iframe')

    for (let i = 0; i < 6; i++) {
      await iframe.trigger('error')
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('页面加载失败')

    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('加载中...')
  })

  it('schedules iframe retry reloads before reaching the retry limit', async () => {
    vi.useFakeTimers()
    const targetUrl = 'http://localhost:4100'
    const { wrapper } = await mountAppWindow(targetUrl)
    const iframe = wrapper.get('iframe')
    const srcAssignments: string[] = []
    let iframeSrc = iframe.attributes('src') ?? ''
    Object.defineProperty(iframe.element, 'src', {
      configurable: true,
      get: () => iframeSrc,
      set: (value: string) => {
        iframeSrc = value
        srcAssignments.push(value)
      },
    })

    await iframe.trigger('error')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(srcAssignments).toEqual([''])

    await vi.advanceTimersByTimeAsync(100)
    expect(srcAssignments).toEqual(['', targetUrl])
  })

  it('ignores browser-open failures', async () => {
    vi.resetModules()
    window.history.pushState(null, '', '/?url=http%3A%2F%2Flocalhost%3A5000')
    setupTauriMocks({ rejectCommands: { open_in_browser: new Error('no browser') } })
    const { default: AppWindow } = await import('@/AppWindow.vue')
    const wrapper = mount(AppWindow)

    await wrapper.get('iframe').trigger('load')
    await expect(wrapper.get('button[title="在浏览器中打开"]').trigger('click')).resolves.toBeUndefined()
  })
})
