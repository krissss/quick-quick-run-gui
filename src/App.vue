<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
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
import { useAppSessionStore } from '@/stores/appSession'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import { useMessageStore } from '@/stores/message'
import { useAppFavicons } from '@/composables/useAppFavicons'

const appsStore = useAppsStore()
const launcherStore = useLauncherStore()
const messageStore = useMessageStore()
const sessionStore = useAppSessionStore()

const { faviconUrl, markFaviconFailed } = useAppFavicons(
  computed(() => [...appsStore.apps, appsStore.editForm]),
  computed(() => new Set(appsStore.apps.filter(app => launcherStore.appRunState(app.id).isRunning).map(app => app.id))),
)

const startupTimers: number[] = []

function scheduleStartupLaunches() {
  for (const app of appsStore.apps) {
    if (!app.startup.enabled) continue
    const timer = window.setTimeout(async () => {
      await launcherStore.refreshRunningApps()
      const currentApp = appsStore.apps.find(item => item.id === app.id)
      if (!currentApp || !currentApp.startup.enabled || launcherStore.appRunState(currentApp.id).isRunning) return
      await launcherStore.launchApp(currentApp, { trigger: 'startup' })
    }, Math.max(0, app.startup.delaySeconds) * 1000)
    startupTimers.push(timer)
  }
}

onMounted(async () => {
  await appsStore.refreshApps()
  if (appsStore.apps.length > 0 && appsStore.isNew) {
    appsStore.selectApp(appsStore.apps[0])
  }
  await launcherStore.refreshRunningApps()
  await launcherStore.startEventListeners()
  scheduleStartupLaunches()
})

onUnmounted(() => {
  for (const timer of startupTimers) window.clearTimeout(timer)
  launcherStore.stopEventListeners()
  useLogsStore().closeLogDialog()
})
</script>

<template>
  <div class="flex h-screen min-w-[1040px] bg-background text-foreground font-sans">
    <ToastMessages />

    <AppSidebar
      :favicon-url="faviconUrl"
      @favicon-error="markFaviconFailed"
    />

    <AppDetailForm
      :favicon-url="faviconUrl(appsStore.editForm)"
      @favicon-error="markFaviconFailed"
    />

    <RunParametersDialog />

    <LogDialog />

    <PortManagerDialog
      :open="sessionStore.showPortManagerDialog"
      @close="sessionStore.closePortManagerDialog"
      @message="messageStore.showMessage"
    />

    <SettingsDialog />

    <AlertDialog
      :open="sessionStore.hasPendingUnsavedAction"
      @update:open="(value) => { if (!value && !sessionStore.unsavedActionRunning) sessionStore.clearPendingUnsavedAction() }"
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
          <AlertDialogCancel class="mt-0" :disabled="sessionStore.unsavedActionRunning">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="secondary"
            :disabled="sessionStore.unsavedActionRunning"
            @click="sessionStore.discardAndContinue"
          >
            放弃更改
          </Button>
          <AlertDialogAction
            :disabled="sessionStore.unsavedActionRunning"
            @click.prevent="sessionStore.saveAndContinue"
          >
            {{ sessionStore.unsavedActionRunning ? '保存中' : '保存并继续' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
