import { ref } from 'vue'
import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { loadApps, normalizeApp, saveApps, type AppItem } from '@/lib/store'

export const useAppCatalogStore = defineStore('appCatalog', () => {
  const apps = ref<AppItem[]>([])

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

  function upsertApp(app: AppItem) {
    const index = apps.value.findIndex(item => item.id === app.id)
    if (index !== -1) {
      apps.value[index] = { ...app }
      return
    }
    apps.value.push({ ...app })
  }

  function removeApp(appId: string) {
    apps.value = apps.value
      .filter(app => app.id !== appId)
      .map((app, index) => ({ ...app, order: index }))
  }

  function reorderAppsInMemory(activeId: string, targetId: string) {
    if (!activeId || !targetId || activeId === targetId) return false
    const fromIndex = apps.value.findIndex(app => app.id === activeId)
    const toIndex = apps.value.findIndex(app => app.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return false

    const next = [...apps.value]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    apps.value = next.map((app, index) => ({ ...app, order: index }))
    return true
  }

  function setImportedApps(imported: AppItem[]) {
    apps.value = imported.map(normalizeApp)
  }

  return {
    apps,
    refreshApps,
    persistApps,
    upsertApp,
    removeApp,
    reorderAppsInMemory,
    setImportedApps,
  }
})
