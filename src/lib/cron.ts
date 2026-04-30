export function validateCronExpression(value: string): string | null {
  const parts = value.trim().split(/\s+/)
  if (parts.length !== 5) return '定时表达式需要 5 段，例如 */15 * * * *'

  const validators: Array<[string, number, number]> = [
    ['分钟', 0, 59],
    ['小时', 0, 23],
    ['日期', 1, 31],
    ['月份', 1, 12],
    ['星期', 0, 7],
  ]

  for (let index = 0; index < validators.length; index++) {
    const [label, min, max] = validators[index]
    if (!isCronFieldValid(parts[index], min, max)) {
      return `${label}字段格式不正确`
    }
  }

  return null
}

function isCronFieldValid(value: string, min: number, max: number) {
  return value.split(',').every((rawPart) => {
    const part = rawPart.trim()
    if (!part) return false

    const [rangePart, stepPart, extra] = part.split('/')
    if (extra != null) return false

    if (stepPart != null) {
      const step = parsePositiveInteger(stepPart)
      if (step == null || step === 0) return false
    }

    if (rangePart === '*') return true

    if (rangePart.includes('-')) {
      const [startPart, endPart, extraRange] = rangePart.split('-')
      if (extraRange != null) return false
      const start = parsePositiveInteger(startPart)
      const end = parsePositiveInteger(endPart)
      return start != null && end != null && start >= min && end <= max && start <= end
    }

    const single = parsePositiveInteger(rangePart)
    return single != null && single >= min && single <= max
  })
}

function parsePositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return null
  return Number(value)
}
