<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import AppDetailForm from '@/components/app/AppDetailForm.vue'
import AppSidebar from '@/components/app/AppSidebar.vue'
import LogDialog from '@/components/app/LogDialog.vue'
import SettingsDialog from '@/components/app/SettingsDialog.vue'
import ToastMessages from '@/components/app/ToastMessages.vue'
import RunParametersDialog from '@/components/command/RunParametersDialog.vue'
import { useApps } from '@/composables/useApps'
import { useLauncher } from '@/composables/useLauncher'
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
  logLaunchFailed,
  logLaunchFailedReason,
  logWindowOpened,
  openLogDialog,
  closeLogDialog,
} = useLogs()

const {
  apps,
  editForm,
  isNew,
  selectApp,
  openAddForm,
  duplicateApp,
  refreshApps,
  saveApp,
  deleteApp,
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
  refreshRunningApps,
  launchApp,
  stopApp,
  showAppWindow,
} = useLauncher(apps, showMessage, openLogDialog)

const {
  showSettingsDialog,
  autostartEnabled,
  hideDockOnClose,
  themeIcon,
  themeLabel,
  toggleTheme,
  openSettingsDialog,
  toggleAutostart,
  toggleHideDockOnClose,
  closeSettingsDialog,
  handleExport,
  handleImport,
} = useSettings(apps, showMessage)

const runDialogApp = ref<AppItem | null>(null)
const startupTimers: number[] = []

function commandParamsFor(app: AppItem) {
  return parseCommandSignature(app.command).params
}

function closeRunDialog() {
  runDialogApp.value = null
}

async function requestLaunch(app: AppItem) {
  if (commandParamsFor(app).length > 0) {
    runDialogApp.value = app
    return
  }
  await launchApp(app)
}

function duplicateSelectedApp() {
  if (!editForm.value.id) return
  duplicateApp(editForm.value)
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

function openExistingLogDialog(app: AppItem) {
  openLogDialog(app, true)
}

function scheduleStartupLaunches() {
  for (const app of apps.value) {
    if (!app.startup.enabled) continue
    const timer = window.setTimeout(async () => {
      await refreshRunningApps()
      const currentApp = apps.value.find(item => item.id === app.id)
      if (!currentApp || !currentApp.startup.enabled || runningAppIds.value.has(currentApp.id)) return
      await launchApp(currentApp, { trigger: 'startup', openLog: false })
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
  <div class="flex h-screen min-w-[920px] bg-background text-foreground font-sans">
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
      @add="openAddForm"
      @select="selectApp"
      @reorder="reorderApps"
      @open-settings="openSettingsDialog"
    />

    <AppDetailForm
      v-model="editForm"
      :is-new="isNew"
      :running-app-ids="runningAppIds"
      :running-pids="runningPids"
      :latest-runs="latestRuns"
      @save="saveApp"
      @duplicate="duplicateSelectedApp"
      @launch="requestLaunch"
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
    />

    <RunParametersDialog
      :open="!!runDialogApp"
      :app="runDialogApp"
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
      :launch-failed="logLaunchFailed"
      :launch-failed-reason="logLaunchFailedReason"
      :window-opened="logWindowOpened"
      :running-app-ids="runningAppIds"
      @close="closeLogDialog"
      @relaunch="relaunchFromLog"
    />

    <SettingsDialog
      :open="showSettingsDialog"
      :autostart-enabled="autostartEnabled"
      :hide-dock-on-close="hideDockOnClose"
      :theme-icon="themeIcon"
      :theme-label="themeLabel"
      @close="closeSettingsDialog"
      @toggle-autostart="toggleAutostart"
      @toggle-hide-dock-on-close="toggleHideDockOnClose"
      @toggle-theme="toggleTheme"
      @import-data="handleImport"
      @export-data="handleExport"
    />
  </div>
</template>
