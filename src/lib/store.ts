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
  command: string
  url: string
  width: number
  height: number
  iconUrl?: string
}

export async function loadApps(): Promise<AppItem[]> {
  const store = await getStore()

  // 尝试从 store 读取
  const apps = await store.get<AppItem[]>(APPS_KEY)
  if (apps) return apps

  // 首次使用：尝试从 localStorage 迁移
  try {
    const raw = localStorage.getItem(LS_KEY_APPS)
    if (raw) {
      const migrated = JSON.parse(raw)
      await store.set(APPS_KEY, migrated)
      await store.save()
      localStorage.removeItem(LS_KEY_APPS)
      return migrated
    }
  } catch { /* ignore */ }

  return []
}

export async function saveApps(apps: AppItem[]): Promise<void> {
  const store = await getStore()
  await store.set(APPS_KEY, apps)
  await store.save()
}

export async function exportData(): Promise<string> {
  const store = await getStore()
  const apps = await store.get<AppItem[]>(APPS_KEY) || []
  return JSON.stringify(apps, null, 2)
}

export async function importData(json: string): Promise<AppItem[]> {
  const apps = JSON.parse(json) as AppItem[]
  if (!Array.isArray(apps)) throw new Error('数据格式错误')
  await saveApps(apps)
  return apps
}
