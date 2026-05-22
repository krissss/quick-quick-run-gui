import { computed, ref, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import {
  defaultSchedule,
  normalizeApp,
  type AppItem,
  type AppType,
  type MissedPolicy,
  type RestartConfig,
  type RetryConfig,
  type StartupConfig,
} from '@/lib/store'
import { emptyApp } from './appDefaults'
import { useAppCatalogStore } from './appCatalog'

export const useAppEditorStore = defineStore('appEditor', () => {
  const catalog = useAppCatalogStore()
  const { apps } = storeToRefs(catalog)
  const editForm = ref<AppItem>(emptyApp())
  const isNew = ref(true)

  function appSnapshot(app: AppItem) {
    return JSON.stringify(normalizeApp(app))
  }

  const editSnapshot = ref(appSnapshot(editForm.value))

  function resetEditSnapshot() {
    editSnapshot.value = appSnapshot(editForm.value)
  }

  const hasUnsavedChanges = computed(() => appSnapshot(editForm.value) !== editSnapshot.value)

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
    resetEditSnapshot()
  }

  function openAddForm() {
    isNew.value = true
    editForm.value = emptyApp()
    resetEditSnapshot()
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

  const currentCatalogApp = computed(() => {
    const id = editForm.value.id
    if (!id || isNew.value) return null
    return apps.value.find(app => app.id === id) ?? null
  })

  watch(currentCatalogApp, (updated) => {
    if (updated) {
      editForm.value = normalizeApp(updated)
      resetEditSnapshot()
    } else if (editForm.value.id && !isNew.value) {
      openAddForm()
    }
  })

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

  function updateForm(patch: Partial<AppItem>) {
    editForm.value = { ...editForm.value, ...patch }
  }

  function replaceForm(app: AppItem) {
    editForm.value = normalizeApp(app)
    resetEditSnapshot()
  }

  return {
    editForm,
    isNew,
    hasUnsavedChanges,
    selectApp,
    openAddForm,
    duplicateApp,
    resetEditSnapshot,
    setAppType,
    setScheduleEnabled,
    setMissedPolicy,
    setScheduleCron,
    setStartup,
    setRestart,
    setRetry,
    touchSchedule,
    updateForm,
    replaceForm,
  }
})
