import { describe, expect, it } from 'vitest'
import { validateCronExpression } from '@/lib/cron'

describe('validateCronExpression', () => {
  it('accepts common five-field cron expressions', () => {
    expect(validateCronExpression('*/15 * * * *')).toBeNull()
    expect(validateCronExpression('0 9 * * 1-5')).toBeNull()
    expect(validateCronExpression('0,30 9-18/3 1 * 0,7')).toBeNull()
  })

  it('rejects expressions with the wrong field count', () => {
    expect(validateCronExpression('* * * *')).toBe('定时表达式需要 5 段，例如 */15 * * * *')
    expect(validateCronExpression('* * * * * *')).toBe('定时表达式需要 5 段，例如 */15 * * * *')
  })

  it('rejects fields outside the supported range', () => {
    expect(validateCronExpression('60 * * * *')).toBe('分钟字段格式不正确')
    expect(validateCronExpression('0 24 * * *')).toBe('小时字段格式不正确')
    expect(validateCronExpression('0 9 0 * *')).toBe('日期字段格式不正确')
    expect(validateCronExpression('0 9 * 13 *')).toBe('月份字段格式不正确')
    expect(validateCronExpression('0 9 * * 8')).toBe('星期字段格式不正确')
  })

  it('rejects malformed lists, ranges, and steps', () => {
    expect(validateCronExpression('*/0 * * * *')).toBe('分钟字段格式不正确')
    expect(validateCronExpression('10-5 * * * *')).toBe('分钟字段格式不正确')
    expect(validateCronExpression('1,,2 * * * *')).toBe('分钟字段格式不正确')
    expect(validateCronExpression('1/2/3 * * * *')).toBe('分钟字段格式不正确')
  })
})
