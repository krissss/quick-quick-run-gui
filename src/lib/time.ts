export function formatDateTime(timestamp: number | null | undefined) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

export function formatDuration(startedAt: number, finishedAt: number | null) {
  if (!finishedAt || finishedAt < startedAt) return '运行中'
  const totalSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

export function formatLogLine(line: string) {
  return line.replace(/\[qqr\] started at (\d{12,13}):/, (_, value: string) => {
    return `[qqr] started at ${formatDateTime(Number(value))}:`
  })
}
