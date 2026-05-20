<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import AppDetailForm from '@/components/app/AppDetailForm.vue'
import AppSidebar from '@/components/app/AppSidebar.vue'
import LogDialog from '@/components/app/LogDialog.vue'
import PortManagerDialog from '@/components/app/PortManagerDialog.vue'
import SettingsDialog from '@/components/app/SettingsDialog.vue'
import ToastMessages from '@/components/app/ToastMessages.vue'
import RunParametersDialog from '@/components/command/RunParametersDialog.vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useApps } from '@/composables/useApps'
import { useLauncher, type LaunchOptions } from '@/composables/useLauncher'
import { useLogs } from '@/composables/useLogs'
import { useMessage } from '@/composables/useMessage'
import { useSettings } from '@/composables/useSettings'
import { parseCommandSignature, type AppItem } from '@/lib/store'

const { messages, showMessage, dismissMessage } = useMessage()

const {
  showLogDialog,
  logAppId,
  logAppName,
  logLines,
  logRuns,
  selectedLogRunId,
  logLaunchFailed,
  logLaunchFailedReason,
  logWindowOpened,
  openLogDialog,
  selectLogRun,
  clearSelectedLogRun,
  clearAllLogRuns,
  closeLogDialog,
} = useLogs(showMessage)

const {
  apps,
  editForm,
  isNew,
  hasUnsavedChanges,
  selectApp,
  openAddForm,
  duplicateApp,
  refreshApps,
  saveApp,
  deleteApp,
  resetEditSnapshot,
  reorderApps,
  updateAppProfiles,
  setAppType,
  setScheduleEnabled,
  setMissedPolicy,
  setScheduleCron,
  setStartup,
  setRestart,
  setRetry,
} = useApps(showMessage)

const {
  runningAppIds,
  runningPids,
  latestRuns,
  pendingLaunches,
  restartingAppIds,
  refreshRunningApps,
  launchApp,
  cancelDelayedLaunch,
  stopApp,
  restartApp,
  showAppWindow,
} = useLauncher(apps, showMessage, openLogDialog)

const {
  showSettingsDialog,
  autostartEnabled,
  hideDockOnClose,
  logRetentionLimit,
  gracefulStopTimeoutSeconds,
  checkingForUpdates,
  appVersion,
  availableUpdateVersion,
  updateReleaseNotes,
  updateInProgress,
  updateProgressPercent,
  updateProgressLabel,
  themeIcon,
  themeLabel,
  toggleTheme,
  openSettingsDialog,
  toggleAutostart,
  toggleHideDockOnClose,
  updateLogRetentionLimit,
  updateGracefulStopTimeoutSeconds,
  closeSettingsDialog,
  checkForUpdates,
  installAvailableUpdate,
  handleExport,
  handleImport,
} = useSettings(apps, showMessage)

const runDialogApp = ref<AppItem | null>(null)
const runDialogLaunchOptions = ref<LaunchOptions>({})
const showPortManagerDialog = ref(false)
const pendingUnsavedAction = ref<(() => void | Promise<void>) | null>(null)
const unsavedActionRunning = ref(false)
const startupTimers: number[] = []

function commandParamsFor(app: AppItem) {
  return parseCommandSignature(app.command).params
}

function closeRunDialog() {
  runDialogApp.value = null
  runDialogLaunchOptions.value = {}
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
  if (!hasUnsavedChanges.value) {
    await action()
    return
  }
  pendingUnsavedAction.value = action
}

async function saveAndContinue() {
  if (!pendingUnsavedAction.value || unsavedActionRunning.value) return
  unsavedActionRunning.value = true
  const saved = await saveApp()
  unsavedActionRunning.value = false
  if (saved) await continueWithPendingAction()
}

async function discardAndContinue() {
  if (!pendingUnsavedAction.value || unsavedActionRunning.value) return
  resetEditSnapshot()
  await continueWithPendingAction()
}

async function handleSelectApp(app: AppItem) {
  await guardUnsavedChanges(() => selectApp(app))
}

async function handleOpenAddForm() {
  await guardUnsavedChanges(openAddForm)
}

async function requestLaunch(app: AppItem, options: LaunchOptions = {}) {
  if (commandParamsFor(app).length > 0) {
    runDialogApp.value = app
    runDialogLaunchOptions.value = options
    return
  }
  await launchApp(app, options)
}

async function duplicateSelectedApp() {
  if (!editForm.value.id) return
  const sourceId = editForm.value.id
  await guardUnsavedChanges(() => {
    const source = apps.value.find(item => item.id === sourceId) || editForm.value
    duplicateApp(source)
  })
}

async function chooseWorkingDirectory() {
  try {
    const selected = await dialogOpen({
      directory: true,
      multiple: false,
      defaultPath: editForm.value.workingDirectory || undefined,
    })
    if (typeof selected === 'string') {
      editForm.value.workingDirectory = selected
    }
  } catch {
    showMessage('选择工作目录失败', 'error')
  }
}

async function relaunchFromLog(appId: string) {
  const app = apps.value.find(item => item.id === appId)
  if (app) await requestLaunch(app)
}

async function openExistingLogDialog(app: AppItem) {
  await openLogDialog(app, true)
}

function scheduleStartupLaunches() {
  for (const app of apps.value) {
    if (!app.startup.enabled) continue
    const timer = window.setTimeout(async () => {
      await refreshRunningApps()
      const currentApp = apps.value.find(item => item.id === app.id)
      if (!currentApp || !currentApp.startup.enabled || runningAppIds.value.has(currentApp.id)) return
      await launchApp(currentApp, { trigger: 'startup' })
    }, Math.max(0, app.startup.delaySeconds) * 1000)
    startupTimers.push(timer)
  }
}

onMounted(async () => {
  await refreshApps()
  if (apps.value.length > 0 && isNew.value) {
    selectApp(apps.value[0])
  }
  await refreshRunningApps()
  scheduleStartupLaunches()
})

onUnmounted(() => {
  for (const timer of startupTimers) window.clearTimeout(timer)
})
</script>

<template>
  <div class="flex h-screen min-w-[1040px] bg-background text-foreground font-sans">
    <ToastMessages
      :messages="messages"
      @dismiss="dismissMessage"
    />

    <AppSidebar
      :apps="apps"
      :selected-app-id="editForm.id"
      :is-new="isNew"
      :running-app-ids="runningAppIds"
      :latest-runs="latestRuns"
      :pending-launches="pendingLaunches"
      @add="handleOpenAddForm"
      @select="handleSelectApp"
      @reorder="reorderApps"
      @open-ports="openPortManagerDialog"
      @open-settings="openSettingsDialog"
    />

    <AppDetailForm
      v-model="editForm"
      :is-new="isNew"
      :running-app-ids="runningAppIds"
      :running-pids="runningPids"
      :latest-runs="latestRuns"
      :pending-launches="pendingLaunches"
      :restarting-app-ids="restartingAppIds"
      @save="saveApp"
      @duplicate="duplicateSelectedApp"
      @launch="requestLaunch"
      @cancel-delayed-launch="cancelDelayedLaunch"
      @delete="deleteApp"
      @set-type="setAppType"
      @set-schedule-enabled="setScheduleEnabled"
      @set-missed-policy="setMissedPolicy"
      @set-schedule-cron="setScheduleCron"
      @set-startup="setStartup"
      @set-restart="setRestart"
      @set-retry="setRetry"
      @choose-working-directory="chooseWorkingDirectory"
      @show-window="showAppWindow"
      @open-log="openExistingLogDialog"
      @stop="stopApp"
      @restart="restartApp"
    />

    <RunParametersDialog
      :open="!!runDialogApp"
      :app="runDialogApp"
      :launch-options="runDialogLaunchOptions"
      :persist-profiles="updateAppProfiles"
      @close="closeRunDialog"
      @launch="launchApp"
      @message="showMessage"
    />

    <LogDialog
      :open="showLogDialog"
      :app-id="logAppId"
      :app-name="logAppName"
      :lines="logLines"
      :runs="logRuns"
      :selected-run-id="selectedLogRunId"
      :launch-failed="logLaunchFailed"
      :launch-failed-reason="logLaunchFailedReason"
      :window-opened="logWindowOpened"
      :running-app-ids="runningAppIds"
      @select-run="selectLogRun"
      @clear-selected="clearSelectedLogRun"
      @clear-all="clearAllLogRuns"
      @close="closeLogDialog"
      @stop="stopApp"
      @relaunch="relaunchFromLog"
    />

    <PortManagerDialog
      :open="showPortManagerDialog"
      @close="closePortManagerDialog"
      @message="showMessage"
    />

    <SettingsDialog
      :open="showSettingsDialog"
      :autostart-enabled="autostartEnabled"
      :hide-dock-on-close="hideDockOnClose"
      :log-retention-limit="logRetentionLimit"
      :graceful-stop-timeout-seconds="gracefulStopTimeoutSeconds"
      :checking-for-updates="checkingForUpdates"
      :app-version="appVersion"
      :available-update-version="availableUpdateVersion"
      :update-release-notes="updateReleaseNotes"
      :update-in-progress="updateInProgress"
      :update-progress-percent="updateProgressPercent"
      :update-progress-label="updateProgressLabel"
      :theme-icon="themeIcon"
      :theme-label="themeLabel"
      @close="closeSettingsDialog"
      @toggle-autostart="toggleAutostart"
      @toggle-hide-dock-on-close="toggleHideDockOnClose"
      @update-log-retention-limit="updateLogRetentionLimit"
      @update-graceful-stop-timeout-seconds="updateGracefulStopTimeoutSeconds"
      @check-updates="checkForUpdates"
      @install-update="installAvailableUpdate"
      @toggle-theme="toggleTheme"
      @import-data="handleImport"
      @export-data="handleExport"
    />

    <AlertDialog
      :open="!!pendingUnsavedAction"
      @update:open="(value) => { if (!value && !unsavedActionRunning) clearPendingUnsavedAction() }"
    >
      <AlertDialogContent class="w-[min(calc(100vw-2rem),32rem)] border-0 bg-card p-0 shadow-[var(--shadow-card)]">
        <div class="px-5 pt-5">
          <AlertDialogHeader>
            <AlertDialogTitle class="text-base tracking-[-0.32px]">有未保存的更改</AlertDialogTitle>
            <AlertDialogDescription class="leading-6">
              当前表单还没有保存。继续操作会切换当前编辑内容，请先选择如何处理这些更改。
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        <AlertDialogFooter class="bg-muted/40 px-5 py-3 shadow-[inset_0_1px_0_0_var(--border)]">
          <AlertDialogCancel class="mt-0" :disabled="unsavedActionRunning">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="secondary"
            :disabled="unsavedActionRunning"
            @click="discardAndContinue"
          >
            放弃更改
          </Button>
          <AlertDialogAction
            :disabled="unsavedActionRunning"
            @click.prevent="saveAndContinue"
          >
            {{ unsavedActionRunning ? '保存中' : '保存并继续' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
