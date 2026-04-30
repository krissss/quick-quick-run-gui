import { Store } from '@tauri-apps/plugin-store'

const STORE_FILE = 'qqr-store.json'
const APPS_KEY = 'apps'
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
  return {
    id: app.id || '',
    name: app.name || '',
    type,
    command: app.command || '',
    url: app.url || '',
    width: app.width || 1200,
    height: app.height || 800,
    order: app.order,
    schedule: {
      ...defaultSchedule(),
      ...(app.schedule || {}),
      missedPolicy: app.schedule?.missedPolicy || 'skip',
      timezone: app.schedule?.timezone || 'Asia/Shanghai',
    },
  }
}

export async function loadApps(): Promise<AppItem[]> {
  const store = await getStore()

  // 尝试从 store 读取
  const apps = await store.get<AppItem[]>(APPS_KEY)
  if (apps) return apps.map(normalizeApp)

  // 首次使用：尝试从 localStorage 迁移
  try {
    const raw = localStorage.getItem(LS_KEY_APPS)
    if (raw) {
      const migrated = JSON.parse(raw)
      const normalized = migrated.map(normalizeApp)
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
  await store.set(APPS_KEY, apps.map(normalizeApp))
  await store.save()
}

export async function exportData(): Promise<string> {
  const store = await getStore()
  const apps = (await store.get<AppItem[]>(APPS_KEY) || []).map(normalizeApp)
  return JSON.stringify(apps, null, 2)
}

export async function importData(json: string): Promise<AppItem[]> {
  const apps = JSON.parse(json) as Partial<AppItem>[]
  if (!Array.isArray(apps)) throw new Error('数据格式错误')
  const normalized = apps.map(normalizeApp)
  await saveApps(normalized)
  return normalized
}
