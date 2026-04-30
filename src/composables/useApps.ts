import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { validateCronExpression } from '@/lib/cron'
import { defaultSchedule, loadApps, normalizeApp, saveApps, type AppItem, type AppType, type MissedPolicy } from '@/lib/store'

export function emptyApp(): AppItem {
  return { id: '', name: '', type: 'web', command: '', url: '', width: 1200, height: 800, schedule: defaultSchedule() }
}

export function useApps(showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void) {
  const apps = ref<AppItem[]>([])
  const editForm = ref<AppItem>(emptyApp())
  const isNew = ref(true)

  function selectApp(app: AppItem) {
    isNew.value = false
    editForm.value = normalizeApp(app)
  }

  function openAddForm() {
    isNew.value = true
    editForm.value = emptyApp()
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
    await saveApps(apps.value)
    try { await invoke('notify_apps_updated') } catch { /* ignore */ }
  }

  async function saveApp() {
    const app = normalizeApp(editForm.value)
    if (!app.name.trim()) {
      showMessage('请填写名称', 'error')
      return
    }
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
    const wasNew = isNew.value
    if (!wasNew) {
      const idx = apps.value.findIndex(a => a.id === app.id)
      if (idx !== -1) apps.value[idx] = { ...app }
    } else {
      app.id = crypto.randomUUID()
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

  function touchSchedule() {
    const schedule = { ...(editForm.value.schedule || defaultSchedule()), lastRunAt: Date.now() }
    editForm.value = normalizeApp({ ...editForm.value, schedule })
  }

  async function deleteApp() {
    if (!editForm.value.id) return
    apps.value = apps.value.filter(a => a.id !== editForm.value.id)
    await persistApps()
    editForm.value = emptyApp()
    isNew.value = true
    showMessage('已删除', 'success')
  }

  return {
    apps, editForm, isNew,
    selectApp, openAddForm, refreshApps, persistApps, saveApp, deleteApp,
    setAppType, setScheduleEnabled, setMissedPolicy, setScheduleCron, touchSchedule,
  }
}
