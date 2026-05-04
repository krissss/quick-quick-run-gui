import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { validateCronExpression } from '@/lib/cron'
import {
  defaultRestart,
  defaultRetry,
  defaultSchedule,
  defaultStartup,
  loadApps,
  normalizeApp,
  saveApps,
  type AppItem,
  type AppProfile,
  type AppType,
  type MissedPolicy,
  type RestartConfig,
  type RetryConfig,
  type StartupConfig,
} from '@/lib/store'

export function emptyApp(): AppItem {
  return {
    id: '',
    name: '',
    type: 'web',
    command: '',
    workingDirectory: '',
    url: '',
    width: 1200,
    height: 800,
    profiles: [],
    activeProfileId: '',
    schedule: defaultSchedule(),
    startup: defaultStartup(),
    restart: defaultRestart(),
    retry: defaultRetry(),
  }
}

function defaultAppName(app: AppItem) {
  const command = app.command.trim()
  if (command) return command
  if (app.type === 'web') return app.url.trim()
  return ''
}

export function useApps(showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void) {
  const apps = ref<AppItem[]>([])
  const editForm = ref<AppItem>(emptyApp())
  const isNew = ref(true)

  function buildDuplicateName(sourceName: string) {
    const baseName = (sourceName.trim() || '未命名').replace(/\s*副本(?:\s+\d+)?$/, '').trim() || '未命名'
    const existingNames = new Set(apps.value.map(app => app.name.trim()))
    let candidate = `${baseName} 副本`
    let suffix = 2
    while (existingNames.has(candidate)) {
      candidate = `${baseName} 副本 ${suffix}`
      suffix += 1
    }
    return candidate
  }

  function selectApp(app: AppItem) {
    isNew.value = false
    editForm.value = normalizeApp(app)
  }

  function openAddForm() {
    isNew.value = true
    editForm.value = emptyApp()
  }

  function duplicateApp(app: AppItem) {
    const source = normalizeApp(app)
    isNew.value = true
    editForm.value = normalizeApp({
      ...source,
      id: '',
      name: buildDuplicateName(source.name),
      order: undefined,
      schedule: {
        ...source.schedule,
        lastRunAt: Date.now(),
      },
    })
  }

  // 当 apps 列表变化时同步表单（比如删除后）
  watch(apps, () => {
    if (!isNew.value && editForm.value.id) {
      const still = apps.value.find(a => a.id === editForm.value.id)
      if (still) {
        editForm.value = normalizeApp(still)
      } else {
        isNew.value = true
        editForm.value = emptyApp()
      }
    }
  })

  async function refreshApps() {
    apps.value = (await loadApps()).map(normalizeApp)
  }

  async function persistApps() {
    const orderedApps = apps.value.map((app, index) => ({ ...app, order: index }))
    const orderChanged = orderedApps.some((app, index) => apps.value[index]?.order !== app.order)
    if (orderChanged) apps.value = orderedApps
    await saveApps(orderedApps)
    try { await invoke('notify_apps_updated') } catch { /* ignore */ }
  }

  async function saveApp() {
    const app = normalizeApp(editForm.value)
    if (app.type === 'web' && !app.url.trim()) {
      showMessage('请填写目标 URL', 'error')
      return
    }
    if (app.type !== 'web' && !app.command.trim()) {
      showMessage('请填写执行命令', 'error')
      return
    }
    if (app.type === 'task' && app.schedule.enabled) {
      const cron = app.schedule.cron.trim()
      if (!cron) {
        showMessage('请填写定时表达式', 'error')
        return
      }
      const cronError = validateCronExpression(cron)
      if (cronError) {
        showMessage(cronError, 'error')
        return
      }
    }
    if (!app.name.trim()) app.name = defaultAppName(app)
    const wasNew = isNew.value
    if (!wasNew) {
      const idx = apps.value.findIndex(a => a.id === app.id)
      if (idx !== -1) apps.value[idx] = { ...app }
    } else {
      app.id = crypto.randomUUID()
      app.order = apps.value.length
      apps.value.push({ ...app })
      isNew.value = false
    }
    editForm.value = { ...app }
    await persistApps()
    showMessage(wasNew ? '已添加' : '已保存', 'success')
  }

  function setAppType(type: AppType) {
    editForm.value = normalizeApp({ ...editForm.value, type })
  }

  function setScheduleEnabled(enabled: boolean) {
    const schedule = { ...(editForm.value.schedule || defaultSchedule()), enabled, lastRunAt: Date.now() }
    editForm.value = normalizeApp({ ...editForm.value, schedule })
  }

  function setMissedPolicy(missedPolicy: MissedPolicy) {
    const schedule = { ...(editForm.value.schedule || defaultSchedule()), missedPolicy, lastRunAt: Date.now() }
    editForm.value = normalizeApp({ ...editForm.value, schedule })
  }

  function setScheduleCron(cron: string) {
    const schedule = { ...(editForm.value.schedule || defaultSchedule()), cron, lastRunAt: Date.now() }
    editForm.value = normalizeApp({ ...editForm.value, schedule })
  }

  function setStartup(startup: StartupConfig) {
    editForm.value = normalizeApp({ ...editForm.value, startup })
  }

  function setRestart(restart: RestartConfig) {
    editForm.value = normalizeApp({ ...editForm.value, restart })
  }

  function setRetry(retry: RetryConfig) {
    editForm.value = normalizeApp({ ...editForm.value, retry })
  }

  function touchSchedule() {
    const schedule = { ...(editForm.value.schedule || defaultSchedule()), lastRunAt: Date.now() }
    editForm.value = normalizeApp({ ...editForm.value, schedule })
  }

  async function deleteApp() {
    if (!editForm.value.id) return
    apps.value = apps.value
      .filter(a => a.id !== editForm.value.id)
      .map((app, index) => ({ ...app, order: index }))
    await persistApps()
    editForm.value = emptyApp()
    isNew.value = true
    showMessage('已删除', 'success')
  }

  async function reorderApps(activeId: string, targetId: string) {
    if (!activeId || !targetId || activeId === targetId) return
    const fromIndex = apps.value.findIndex(app => app.id === activeId)
    const toIndex = apps.value.findIndex(app => app.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const next = [...apps.value]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    apps.value = next.map((app, index) => ({ ...app, order: index }))
    await persistApps()
  }

  async function updateAppProfiles(app: AppItem, profiles: AppProfile[], activeProfileId: string) {
    const nextApp = {
      ...app,
      profiles,
      activeProfileId,
    }
    const appIndex = apps.value.findIndex(item => item.id === app.id)
    if (appIndex !== -1) {
      apps.value[appIndex] = {
        ...apps.value[appIndex],
        profiles,
        activeProfileId,
      }
      await persistApps()
    }
    if (editForm.value.id === app.id) {
      editForm.value = {
        ...editForm.value,
        profiles,
        activeProfileId,
      }
    }
    return nextApp
  }

  return {
    apps, editForm, isNew,
    selectApp, openAddForm, duplicateApp, refreshApps, persistApps, saveApp, deleteApp,
    reorderApps, updateAppProfiles,
    setAppType, setScheduleEnabled, setMissedPolicy, setScheduleCron, setStartup, setRestart, setRetry, touchSchedule,
  }
}
