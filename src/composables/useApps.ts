import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { loadApps, saveApps, type AppItem } from '@/lib/store'

export function emptyApp(): AppItem {
  return { id: '', name: '', command: '', url: '', width: 1200, height: 800 }
}

export function useApps(showMessage: (msg: string, type?: 'success' | 'error' | 'info') => void) {
  const apps = ref<AppItem[]>([])
  const editForm = ref<AppItem>(emptyApp())
  const isNew = ref(true)

  function selectApp(app: AppItem) {
    isNew.value = false
    editForm.value = { ...app }
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
        editForm.value = { ...still }
      } else {
        isNew.value = true
        editForm.value = emptyApp()
      }
    }
  })

  async function refreshApps() {
    apps.value = await loadApps()
  }

  async function persistApps() {
    await saveApps(apps.value)
    try { await invoke('notify_apps_updated') } catch { /* ignore */ }
  }

  async function saveApp() {
    if (!editForm.value.name.trim() || !editForm.value.url.trim()) {
      showMessage('请填写应用名称和目标 URL', 'error')
      return
    }
    const wasNew = isNew.value
    if (!wasNew) {
      const idx = apps.value.findIndex(a => a.id === editForm.value.id)
      if (idx !== -1) apps.value[idx] = { ...editForm.value }
    } else {
      editForm.value.id = crypto.randomUUID()
      apps.value.push({ ...editForm.value })
      isNew.value = false
    }
    await persistApps()
    showMessage(wasNew ? '已添加' : '已保存', 'success')
  }

  async function deleteApp() {
    if (!editForm.value.id) return
    apps.value = apps.value.filter(a => a.id !== editForm.value.id)
    await persistApps()
    editForm.value = emptyApp()
    isNew.value = true
    showMessage('已删除', 'success')
  }

  return { apps, editForm, isNew, selectApp, openAddForm, refreshApps, persistApps, saveApp, deleteApp }
}
