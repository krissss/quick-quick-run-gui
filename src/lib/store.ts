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

async function getFreshStore(): Promise<Store> {
  const store = await getStore()
  await store.reload()
  return store
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
  profiles: AppProfile[]
  activeProfileId: string
  schedule: ScheduleConfig
}

export type AppType = 'web' | 'service' | 'task'
export type MissedPolicy = 'skip' | 'run-once'
export type CommandParamType = 'text' | 'bool'
export type CommandParamKind = 'option' | 'argument'

export interface AppProfile {
  id: string
  name: string
  values: Record<string, string>
}

export interface CommandParam {
  key: string
  type: CommandParamType
  kind: CommandParamKind
  default: string
  label: string
}

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

function normalizeProfiles(profiles: Partial<AppProfile>[] | undefined): AppProfile[] {
  const seen = new Set<string>()
  return (profiles || []).map((profile, index) => {
    let id = profile.id?.trim() || `profile-${index + 1}`
    while (seen.has(id)) id = `${id}-${index + 1}`
    seen.add(id)
    const values = profile.values && typeof profile.values === 'object' ? profile.values : {}
    return {
      id,
      name: profile.name?.trim() || `方案 ${index + 1}`,
      values: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value ?? '')]),
      ),
    }
  })
}

function isAppProfile(value: unknown): value is Partial<AppProfile> {
  return !!value && typeof value === 'object'
}

export function normalizeApp(app: Partial<AppItem>): AppItem {
  const type = app.type || 'web'
  const order = typeof app.order === 'number' && Number.isFinite(app.order) ? app.order : undefined
  const profiles = normalizeProfiles(Array.isArray(app.profiles) ? app.profiles.filter(isAppProfile) : undefined)
  const activeProfileId = profiles.some(profile => profile.id === app.activeProfileId) ? app.activeProfileId || '' : ''
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
    profiles,
    activeProfileId,
    schedule: {
      ...defaultSchedule(),
      ...(app.schedule || {}),
      missedPolicy: app.schedule?.missedPolicy || 'skip',
      timezone: app.schedule?.timezone || 'Asia/Shanghai',
    },
  }
}

const SIGNATURE_PATTERN = /\{(--)?([\w-]+)(=((?:(?!\s+[:：])[^}])*))?(\s*[:：]\s*([^}]*))?\}/g

function parseSignatureMatch(match: RegExpMatchArray): CommandParam | null {
  const optionPrefix = match[1]
  const key = match[2]
  const valuePart = match[3]
  const defaultValue = match[4]
  const description = match[6]
  const kind: CommandParamKind = optionPrefix ? 'option' : 'argument'

  if (kind === 'argument' && valuePart == null) return null

  let type: CommandParamType
  let defaultText: string
  if (kind === 'option' && valuePart == null) {
    type = 'bool'
    defaultText = 'false'
  } else if (kind === 'option' && defaultValue != null && ['true', 'false'].includes(defaultValue.trim().toLowerCase())) {
    type = 'bool'
    defaultText = defaultValue.trim().toLowerCase()
  } else {
    type = 'text'
    defaultText = defaultValue?.trim() || ''
  }

  return {
    key,
    type,
    kind,
    default: defaultText,
    label: description?.trim() || key,
  }
}

function normalizeCommandParts(command: string) {
  return command.split(/\s+/).filter(Boolean).join(' ')
}

export function parseCommandSignature(command: string): { baseCommand: string; params: CommandParam[] } {
  const params: CommandParam[] = []
  let baseCommand = ''
  let cursor = 0
  for (const match of command.matchAll(SIGNATURE_PATTERN)) {
    const param = parseSignatureMatch(match)
    if (!param || match.index == null) continue

    baseCommand += command.slice(cursor, match.index)
    baseCommand += param.kind === 'argument' ? param.default : ' '
    params.push(param)
    cursor = match.index + match[0].length
  }
  baseCommand += command.slice(cursor)

  return { baseCommand: normalizeCommandParts(baseCommand), params }
}

function isTruthyParamValue(value: string) {
  return ['true', '1', 'yes'].includes(value.trim().toLowerCase())
}

export function buildCommandWithProfile(command: string, values: Record<string, string> = {}) {
  const optionParams: CommandParam[] = []
  let commandBody = ''
  let cursor = 0

  for (const match of command.matchAll(SIGNATURE_PATTERN)) {
    const param = parseSignatureMatch(match)
    if (!param || match.index == null) continue
    const value = values[param.key] ?? param.default
    commandBody += command.slice(cursor, match.index)
    if (param.kind === 'argument') {
      commandBody += value
    } else {
      commandBody += ' '
      optionParams.push(param)
    }
    cursor = match.index + match[0].length
  }
  commandBody += command.slice(cursor)

  const parts = [normalizeCommandParts(commandBody)]
  for (const param of optionParams) {
    const value = values[param.key] ?? param.default
    if (param.type === 'bool') {
      if (isTruthyParamValue(value)) parts.push(`--${param.key}`)
    } else {
      parts.push(`--${param.key}=${value}`)
    }
  }
  return parts.filter(Boolean).join(' ')
}

export function resolveAppProfile(app: AppItem): AppItem {
  const profile = (app.profiles || []).find(item => item.id === app.activeProfileId)
  return {
    ...app,
    command: buildCommandWithProfile(app.command, profile?.values),
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
  const store = await getFreshStore()

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
  const store = await getFreshStore()
  await store.set(APPS_KEY, normalizeApps(apps, false))
  await store.save()
}

export async function loadHideDockOnClose(): Promise<boolean> {
  const store = await getFreshStore()
  return (await store.get<boolean>(HIDE_DOCK_ON_CLOSE_KEY)) || false
}

export async function saveHideDockOnClose(enabled: boolean): Promise<void> {
  const store = await getFreshStore()
  await store.set(HIDE_DOCK_ON_CLOSE_KEY, enabled)
  await store.save()
}

export async function exportData(): Promise<string> {
  const store = await getFreshStore()
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
