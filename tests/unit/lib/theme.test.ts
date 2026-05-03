import { describe, expect, it, vi } from 'vitest'
import { applyTheme, getTheme, initTheme, isDark, setTheme } from '@/lib/theme'

function mockMatchMedia(matches: boolean) {
  const listeners: Array<() => void> = []
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.push(listener)),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
  return listeners
}

describe('theme helpers', () => {
  it('stores explicit themes and applies the dark class', () => {
    mockMatchMedia(false)

    expect(getTheme()).toBe('system')
    expect(isDark()).toBe(false)

    setTheme('dark')
    expect(getTheme()).toBe('dark')
    expect(isDark()).toBe(true)

    setTheme('light')
    expect(getTheme()).toBe('light')
    expect(isDark()).toBe(false)
  })

  it('uses system color scheme and reacts to preference changes while in system mode', () => {
    const listeners = mockMatchMedia(true)

    initTheme()
    expect(isDark()).toBe(true)

    applyTheme('light')
    expect(isDark()).toBe(false)

    setTheme('system')
    expect(isDark()).toBe(true)
    listeners.forEach((listener) => listener())
    expect(isDark()).toBe(true)
  })
})
