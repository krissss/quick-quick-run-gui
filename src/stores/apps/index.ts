import { storeToRefs } from 'pinia'
import { defineStore } from 'pinia'
import { validateCronExpression } from '@/lib/cron'
import {
  cleanAppProfilesForCommand,
  normalizeApp,
  type AppItem,
  type AppProfile,
} from '@/lib/store'
import { useMessageStore } from '@/stores/message'
import { defaultAppName, emptyApp } from './appDefaults'
import { useAppCatalogStore } from './appCatalog'
import { useAppEditorStore } from './appEditor'

export { emptyApp }

export const useAppsStore = defineStore('apps', () => {
  const catalog = useAppCatalogStore()
  const editor = useAppEditorStore()
  const message = useMessageStore()
  const { apps } = storeToRefs(catalog)
  const { editForm, isNew, hasUnsavedChanges } = storeToRefs(editor)

  async function refreshApps() {
    await catalog.refreshApps()
    if (editor.isNew || !editor.editForm.id) editor.resetEditSnapshot()
  }

  async function saveApp() {
    const app = cleanAppProfilesForCommand(normalizeApp(editor.editForm))
    if (app.type === 'web' && !app.url.trim()) {
      message.showMessage('请填写目标 URL', 'error')
      return false
    }
    if (app.type !== 'web' && !app.command.trim()) {
      message.showMessage('请填写执行命令', 'error')
      return false
    }
    if (app.type === 'task' && app.schedule.enabled) {
      const cron = app.schedule.cron.trim()
      if (!cron) {
        message.showMessage('请填写定时表达式', 'error')
        return false
      }
      const cronError = validateCronExpression(cron)
      if (cronError) {
        message.showMessage(cronError, 'error')
        return false
      }
    }
    if (!app.name.trim()) app.name = defaultAppName(app)
    const wasNew = editor.isNew
    if (wasNew) {
      app.id = crypto.randomUUID()
      app.order = catalog.apps.length
      editor.isNew = false
      catalog.upsertApp(app)
    } else {
      const idx = catalog.apps.findIndex(a => a.id === app.id)
      if (idx !== -1) catalog.apps[idx] = app
    }
    editor.replaceForm(app)
    await catalog.persistApps()
    message.showMessage(wasNew ? '已添加' : '已保存', 'success')
    return true
  }

  async function deleteApp() {
    if (!editor.editForm.id) return
    catalog.removeApp(editor.editForm.id)
    await catalog.persistApps()
    editor.editForm = emptyApp()
    editor.isNew = true
    editor.resetEditSnapshot()
    message.showMessage('已删除', 'success')
  }

  async function reorderApps(activeId: string, targetId: string) {
    const changed = catalog.reorderAppsInMemory(activeId, targetId)
    if (changed) await catalog.persistApps()
  }

  async function updateAppProfiles(app: AppItem, profiles: AppProfile[], activeProfileId: string) {
    const nextApp = {
      ...app,
      profiles,
      activeProfileId,
    }
    const appIndex = catalog.apps.findIndex(item => item.id === app.id)
    if (appIndex !== -1) {
      catalog.apps[appIndex] = {
        ...catalog.apps[appIndex],
        profiles,
        activeProfileId,
      }
      await catalog.persistApps()
    }
    if (editor.editForm.id === app.id) {
      editor.editForm = {
        ...editor.editForm,
        profiles,
        activeProfileId,
      }
      editor.resetEditSnapshot()
    }
    return nextApp
  }

  return {
    apps,
    editForm,
    isNew,
    hasUnsavedChanges,
    selectApp: editor.selectApp,
    openAddForm: editor.openAddForm,
    duplicateApp: editor.duplicateApp,
    refreshApps,
    persistApps: catalog.persistApps,
    saveApp,
    deleteApp,
    resetEditSnapshot: editor.resetEditSnapshot,
    reorderApps,
    updateAppProfiles,
    setAppType: editor.setAppType,
    setScheduleEnabled: editor.setScheduleEnabled,
    setMissedPolicy: editor.setMissedPolicy,
    setScheduleCron: editor.setScheduleCron,
    setStartup: editor.setStartup,
    setRestart: editor.setRestart,
    setRetry: editor.setRetry,
    touchSchedule: editor.touchSchedule,
    updateForm: editor.updateForm,
  }
})
