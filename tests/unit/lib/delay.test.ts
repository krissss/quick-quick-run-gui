import { describe, expect, it } from 'vitest'
import { formatDelayLabel, formatRunAtTime, normalizeDelaySeconds } from '@/lib/delay'

describe('delay helpers', () => {
  it('normalizes delay seconds into a supported range', () => {
    expect(normalizeDelaySeconds('bad')).toBeNull()
    expect(normalizeDelaySeconds(0)).toBeNull()
    expect(normalizeDelaySeconds(1.4)).toBe(1)
    expect(normalizeDelaySeconds(999999)).toBe(86400)
  })

  it('formats delay labels and scheduled run time', () => {
    expect(formatDelayLabel(10)).toBe('10 秒')
    expect(formatDelayLabel(60)).toBe('1 分钟')
    expect(formatDelayLabel(90)).toBe('1 分 30 秒')
    expect(formatDelayLabel(7200)).toBe('2 小时')
    expect(formatRunAtTime(Date.UTC(2026, 4, 4, 6, 30, 0))).not.toContain('1746340200000')
  })
})
