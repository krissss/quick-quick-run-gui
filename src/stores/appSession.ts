import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { parseCommandSignature, type AppItem } from '@/lib/store'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore, type LaunchOptions } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import { useMessageStore } from '@/stores/message'

export const useAppSessionStore = defineStore('appSession', () => {
  const appsStore = useAppsStore()
  const launcherStore = useLauncherStore()
  const logsStore = useLogsStore()
  const messageStore = useMessageStore()

  const runDialogApp = ref<AppItem | null>(null)
  const runDialogLaunchOptions = ref<LaunchOptions>({})
  const editDialogOpen = ref(false)
  const showPortManagerDialog = ref(false)
  const pendingUnsavedAction = ref<(() => void | Promise<void>) | null>(null)
  const unsavedActionRunning = ref(false)

  const hasPendingUnsavedAction = computed(() => !!pendingUnsavedAction.value)

  function commandParamsFor(app: AppItem) {
    return parseCommandSignature(app.command).params
  }

  function closeRunDialog() {
    runDialogApp.value = null
    runDialogLaunchOptions.value = {}
  }

  function openEditDialog() {
    editDialogOpen.value = true
  }

  function closeEditDialog() {
    editDialogOpen.value = false
  }

  async function requestCloseEditDialog() {
    await guardUnsavedChanges(() => {
      closeEditDialog()
    })
  }

  function openPortManagerDialog() {
    showPortManagerDialog.value = true
  }

  function closePortManagerDialog() {
    showPortManagerDialog.value = false
  }

  function clearPendingUnsavedAction() {
    pendingUnsavedAction.value = null
    unsavedActionRunning.value = false
  }

  async function continueWithPendingAction() {
    const action = pendingUnsavedAction.value
    clearPendingUnsavedAction()
    await action?.()
  }

  async function guardUnsavedChanges(action: () => void | Promise<void>) {
    if (!appsStore.hasUnsavedChanges) {
      await action()
      return
    }
    pendingUnsavedAction.value = action
  }

  async function saveAndContinue() {
    if (!pendingUnsavedAction.value || unsavedActionRunning.value) return
    unsavedActionRunning.value = true
    const saved = await appsStore.saveApp()
    unsavedActionRunning.value = false
    if (saved) await continueWithPendingAction()
  }

  async function discardAndContinue() {
    if (!pendingUnsavedAction.value || unsavedActionRunning.value) return
    appsStore.resetEditSnapshot()
    await continueWithPendingAction()
  }

  async function selectApp(app: AppItem) {
    await guardUnsavedChanges(() => appsStore.selectApp(app))
  }

  async function openAddForm() {
    await guardUnsavedChanges(async () => {
      appsStore.openAddForm()
      openEditDialog()
    })
  }

  async function openEditor(app: AppItem) {
    await guardUnsavedChanges(async () => {
      await appsStore.selectApp(app)
      openEditDialog()
    })
  }

  async function duplicateApp(app: AppItem) {
    await guardUnsavedChanges(async () => {
      appsStore.duplicateApp(app)
      openEditDialog()
    })
  }

  async function deleteApp(app: AppItem) {
    await guardUnsavedChanges(async () => {
      await appsStore.selectApp(app)
      await appsStore.deleteApp()
      closeEditDialog()
    })
  }

  async function saveAndCloseEditDialog() {
    const saved = await appsStore.saveApp()
    if (saved) closeEditDialog()
    return saved
  }

  async function requestLaunch(app: AppItem, options: LaunchOptions = {}) {
    if (commandParamsFor(app).length > 0) {
      runDialogApp.value = app
      runDialogLaunchOptions.value = options
      return
    }
    await launcherStore.launchApp(app, options)
  }

  async function duplicateSelectedApp() {
    if (!appsStore.editForm.id) return
    const sourceId = appsStore.editForm.id
    await guardUnsavedChanges(() => {
      const source = appsStore.apps.find(item => item.id === sourceId) || appsStore.editForm
      appsStore.duplicateApp(source)
    })
  }

  async function chooseWorkingDirectory() {
    try {
      const selected = await dialogOpen({
        directory: true,
        multiple: false,
        defaultPath: appsStore.editForm.workingDirectory || undefined,
      })
      if (typeof selected === 'string') {
        appsStore.updateForm({ workingDirectory: selected })
      }
    } catch {
      messageStore.showMessage('选择工作目录失败', 'error')
    }
  }

  async function relaunchFromLog(appId: string) {
    const app = appsStore.apps.find(item => item.id === appId)
    if (app) await requestLaunch(app)
  }

  async function openExistingLogDialog(app: AppItem, runId?: string) {
    await logsStore.openLogDialog(app, true, runId)
  }

  return {
    runDialogApp,
    runDialogLaunchOptions,
    editDialogOpen,
    showPortManagerDialog,
    pendingUnsavedAction,
    hasPendingUnsavedAction,
    unsavedActionRunning,
    closeRunDialog,
    openEditDialog,
    closeEditDialog,
    requestCloseEditDialog,
    openPortManagerDialog,
    closePortManagerDialog,
    clearPendingUnsavedAction,
    guardUnsavedChanges,
    saveAndContinue,
    discardAndContinue,
    selectApp,
    openAddForm,
    openEditor,
    duplicateApp,
    deleteApp,
    saveAndCloseEditDialog,
    requestLaunch,
    duplicateSelectedApp,
    chooseWorkingDirectory,
    relaunchFromLog,
    openExistingLogDialog,
  }
})
