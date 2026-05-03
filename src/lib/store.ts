import { Store } from '@tauri-apps/plugin-store'

const STORE_FILE = 'qqr-store.json'
const APPS_KEY = 'apps'
const HIDE_DOCK_ON_CLOSE_KEY = 'hide_dock_on_close'
const LS_KEY_APPS = 'qqr-apps'

let _store: Store | null = null

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await Store.load(STORE_FILE, { autoSave: false, defaults: {} })
  }
  return _store
}

export interface AppItem {
  id: string
  name: string
  type: AppType
  command: string
  workingDirectory: string
  url: string
  width: number
  height: number
  order?: number
  schedule: ScheduleConfig
}

export type AppType = 'web' | 'service' | 'task'
export type MissedPolicy = 'skip' | 'run-once'

export interface ScheduleConfig {
  enabled: boolean
  cron: string
  timezone: string
  missedPolicy: MissedPolicy
  lastRunAt?: number
}

export function defaultSchedule(): ScheduleConfig {
  return {
    enabled: false,
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    missedPolicy: 'skip',
    lastRunAt: Date.now(),
  }
}

export function normalizeApp(app: Partial<AppItem>): AppItem {
  const type = app.type || 'web'
  const order = typeof app.order === 'number' && Number.isFinite(app.order) ? app.order : undefined
  return {
    id: app.id || '',
    name: app.name || '',
    type,
    command: app.command || '',
    workingDirectory: app.workingDirectory || '',
    url: app.url || '',
    width: app.width || 1200,
    height: app.height || 800,
    order,
    schedule: {
      ...defaultSchedule(),
      ...(app.schedule || {}),
      missedPolicy: app.schedule?.missedPolicy || 'skip',
      timezone: app.schedule?.timezone || 'Asia/Shanghai',
    },
  }
}

export function normalizeApps(apps: Partial<AppItem>[], sortByOrder = true): AppItem[] {
  const normalized = apps
    .map((app, index) => {
      const order = typeof app.order === 'number' && Number.isFinite(app.order) ? app.order : index
      return normalizeApp({ ...app, order })
    })

  const ordered = sortByOrder
    ? [...normalized].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : normalized

  return ordered
    .map((app, index) => ({ ...app, order: index }))
}

export async function loadApps(): Promise<AppItem[]> {
  const store = await getStore()

  // 尝试从 store 读取
  const apps = await store.get<AppItem[]>(APPS_KEY)
  if (apps) return normalizeApps(apps)

  // 首次使用：尝试从 localStorage 迁移
  try {
    const raw = localStorage.getItem(LS_KEY_APPS)
    if (raw) {
      const migrated = JSON.parse(raw)
      const normalized = normalizeApps(migrated)
      await store.set(APPS_KEY, normalized)
      await store.save()
      localStorage.removeItem(LS_KEY_APPS)
      return normalized
    }
  } catch { /* ignore */ }

  return []
}

export async function saveApps(apps: AppItem[]): Promise<void> {
  const store = await getStore()
  await store.set(APPS_KEY, normalizeApps(apps, false))
  await store.save()
}

export async function loadHideDockOnClose(): Promise<boolean> {
  const store = await getStore()
  return (await store.get<boolean>(HIDE_DOCK_ON_CLOSE_KEY)) || false
}

export async function saveHideDockOnClose(enabled: boolean): Promise<void> {
  const store = await getStore()
  await store.set(HIDE_DOCK_ON_CLOSE_KEY, enabled)
  await store.save()
}

export async function exportData(): Promise<string> {
  const store = await getStore()
  const apps = normalizeApps(await store.get<AppItem[]>(APPS_KEY) || [])
  return JSON.stringify(apps, null, 2)
}

export async function importData(json: string): Promise<AppItem[]> {
  const apps = JSON.parse(json) as Partial<AppItem>[]
  if (!Array.isArray(apps)) throw new Error('数据格式错误')
  const normalized = normalizeApps(apps, false)
  await saveApps(normalized)
  return normalized
}
