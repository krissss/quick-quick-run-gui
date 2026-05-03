import type { AppItem, AppType, MissedPolicy } from '@/lib/store'

export interface LatestRunStatus {
  status: 'running' | 'success' | 'failed' | 'killed' | 'lost'
}

const ICON_COLORS = [
  'bg-[#f5f5f5] text-[#171717]',
  'bg-[#e8e8e8] text-[#171717]',
  'bg-[#f0f0f0] text-[#171717]',
]

export function iconGradient(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return ICON_COLORS[Math.abs(hash) % ICON_COLORS.length]
}

export function itemTypeLabel(type: AppType) {
  if (type === 'task') return '任务'
  if (type === 'service') return '服务'
  return '网页'
}

export function primaryActionLabel(app: AppItem) {
  if (app.type === 'task') return '运行'
  return '启动'
}

export function schedulePolicyLabel(value: MissedPolicy) {
  return value === 'run-once' ? '补跑一次' : '跳过'
}

export function runStatusLabel(
  app: AppItem,
  runningAppIds: ReadonlySet<string>,
  latestRuns: ReadonlyMap<string, LatestRunStatus>,
) {
  if (runningAppIds.has(app.id)) return '运行中'
  const run = latestRuns.get(app.id)
  if (!run) return ''
  if (run.status === 'success') return '上次成功'
  if (run.status === 'failed') return '上次失败'
  if (run.status === 'killed') return '已停止'
  if (run.status === 'lost') return '状态丢失'
  return '运行中'
}

export function runStatusClass(
  app: AppItem,
  runningAppIds: ReadonlySet<string>,
  latestRuns: ReadonlyMap<string, LatestRunStatus>,
) {
  if (runningAppIds.has(app.id)) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  const status = latestRuns.get(app.id)?.status
  if (status === 'success') return 'bg-secondary text-foreground'
  if (status === 'failed' || status === 'lost') return 'bg-destructive/10 text-destructive'
  return 'bg-secondary text-muted-foreground'
}

export function statusDotClass(
  app: AppItem,
  runningAppIds: ReadonlySet<string>,
  latestRuns: ReadonlyMap<string, LatestRunStatus>,
) {
  if (runningAppIds.has(app.id)) return 'bg-emerald-500'
  const status = latestRuns.get(app.id)?.status
  if (status === 'failed' || status === 'lost') return 'bg-destructive'
  return 'bg-muted-foreground'
}
