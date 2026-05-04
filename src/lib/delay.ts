export const DELAY_PRESETS = [10, 60, 300, 900]
export const MAX_DELAY_SECONDS = 24 * 60 * 60

export function normalizeDelaySeconds(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null
  const rounded = Math.round(parsed)
  if (rounded <= 0) return null
  return Math.min(MAX_DELAY_SECONDS, rounded)
}

export function formatDelayLabel(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
}

export function formatRunAtTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}
