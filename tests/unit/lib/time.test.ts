import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDuration, formatLogLine } from '@/lib/time'

describe('time helpers', () => {
  it('formats timestamps and durations for display', () => {
    expect(formatDateTime(1767506400000)).not.toBe('1767506400000')
    expect(formatDuration(1000, 2500)).toBe('2s')
    expect(formatDuration(1000, null)).toBe('运行中')
  })

  it('formats legacy qqr log timestamp lines', () => {
    const line = formatLogLine('[qqr] started at 1767506400000: pnpm dev')

    expect(line).toContain('[qqr] started at ')
    expect(line).toContain(': pnpm dev')
    expect(line).not.toContain('1767506400000')
  })
})
