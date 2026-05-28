<script setup lang="ts">
import { computed, ref } from 'vue'
import { onMounted, onUnmounted } from 'vue'
import { History, Play, Timer, Waves } from '@lucide/vue'
import AppDetailForm from '@/components/app/AppDetailForm.vue'
import AppSidebar from '@/components/app/AppSidebar.vue'
import LogDialog from '@/components/app/LogDialog.vue'
import PortManagerDialog from '@/components/app/PortManagerDialog.vue'
import RunningAppCard from '@/components/app/RunningAppCard.vue'
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
import { DialogFrame } from '@/components/ui/dialog-frame'
import { runRecordStatusClass, runRecordStatusLabel } from '@/lib/appDisplay'
import { formatRunAtTime } from '@/lib/delay'
import { formatDateTime } from '@/lib/time'
import type { AppItem } from '@/lib/store'
import { useAppSessionStore } from '@/stores/appSession'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore, type RunRecord } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import { useMessageStore } from '@/stores/message'
import { useAppFavicons } from '@/composables/useAppFavicons'

const appsStore = useAppsStore()
const launcherStore = useLauncherStore()
const messageStore = useMessageStore()
const sessionStore = useAppSessionStore()

const runtimePanelMinWidth = 256
const runtimePanelDefaultWidth = 400
const runtimePanelMaxWidth = 520
const appListMinWidth = 384
const resizeHandleWidth = 8
const runtimePanelWidth = ref(runtimePanelDefaultWidth)
const isRuntimePanelResizing = ref(false)

let runtimePanelResizeStart: { x: number; width: number } | null = null
let previousBodyCursor = ''
let previousBodyUserSelect = ''

const { faviconUrl, markFaviconFailed } = useAppFavicons(
  computed(() => [...appsStore.apps, appsStore.editForm]),
  computed(() => new Set(appsStore.apps.filter(app => launcherStore.appRunState(app.id).isRunning).map(app => app.id))),
)

const startupTimers: number[] = []

const runtimePanelStyle = computed(() => ({
  width: `${runtimePanelWidth.value}px`,
}))

function runtimePanelMaxWidthForWindow() {
  return Math.max(
    runtimePanelMinWidth,
    Math.min(runtimePanelMaxWidth, window.innerWidth - appListMinWidth - resizeHandleWidth),
  )
}

function clampRuntimePanelWidth(width: number) {
  const maxWidth = runtimePanelMaxWidthForWindow()
  return Math.min(maxWidth, Math.max(runtimePanelMinWidth, width))
}

function setResizeCursor() {
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function resetResizeCursor() {
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
}

function handleRuntimePanelResize(event: PointerEvent) {
  if (!runtimePanelResizeStart) return
  const deltaX = event.clientX - runtimePanelResizeStart.x
  runtimePanelWidth.value = clampRuntimePanelWidth(runtimePanelResizeStart.width - deltaX)
}

function stopRuntimePanelResize() {
  if (!runtimePanelResizeStart) return
  runtimePanelResizeStart = null
  isRuntimePanelResizing.value = false
  window.removeEventListener('pointermove', handleRuntimePanelResize)
  window.removeEventListener('pointerup', stopRuntimePanelResize)
  window.removeEventListener('pointercancel', stopRuntimePanelResize)
  resetResizeCursor()
}

function startRuntimePanelResize(event: PointerEvent) {
  if (event.button !== 0) return
  runtimePanelResizeStart = { x: event.clientX, width: runtimePanelWidth.value }
  isRuntimePanelResizing.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  setResizeCursor()
  window.addEventListener('pointermove', handleRuntimePanelResize)
  window.addEventListener('pointerup', stopRuntimePanelResize)
  window.addEventListener('pointercancel', stopRuntimePanelResize)
  event.preventDefault()
}

function handleRuntimePanelResizeKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const delta = event.key === 'ArrowLeft' ? 16 : -16
  runtimePanelWidth.value = clampRuntimePanelWidth(runtimePanelWidth.value + delta)
  event.preventDefault()
}

function handleWindowResize() {
  runtimePanelWidth.value = clampRuntimePanelWidth(runtimePanelWidth.value)
}

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
  window.addEventListener('resize', handleWindowResize)
  scheduleStartupLaunches()
})

onUnmounted(() => {
  for (const timer of startupTimers) window.clearTimeout(timer)
  launcherStore.stopEventListeners()
  window.removeEventListener('resize', handleWindowResize)
  stopRuntimePanelResize()
  useLogsStore().closeLogDialog()
})

const runningApps = computed(() =>
  appsStore.apps.filter(app => launcherStore.appRunState(app.id).isRunning),
)

const pendingApps = computed(() =>
  appsStore.apps.filter(app => launcherStore.appRunState(app.id).pendingLaunch),
)

const scheduledTasks = computed(() =>
  appsStore.apps.filter(app => app.type === 'task' && app.schedule.enabled),
)

const recentRuns = computed(() =>
  launcherStore.recentRuns
    .filter(run => run.status !== 'running')
    .slice(0, 5),
)

function appForRun(run: RunRecord) {
  return appsStore.apps.find(app => app.id === run.app_id) || null
}

function isRunConfirmedRunning(run: RunRecord) {
  return run.status === 'running' && launcherStore.runningAppIds.has(run.app_id)
}

function pendingLabel(app: AppItem) {
  const pending = launcherStore.appRunState(app.id).pendingLaunch
  return pending ? formatRunAtTime(pending.runAt) : ''
}

function openRunLog(run: RunRecord) {
  const app = appForRun(run)
  if (app) void sessionStore.openExistingLogDialog(app, run.id)
}

function runCommandLabel(run: RunRecord) {
  return run.command?.trim() || '未记录命令'
}

function relaunchRunCommand(run: RunRecord) {
  void launcherStore.relaunchRunCommand(run)
}
</script>

<template>
  <div class="flex h-screen min-w-[44rem] bg-background text-foreground font-sans">
    <ToastMessages />

    <AppSidebar
      :favicon-url="faviconUrl"
      @favicon-error="markFaviconFailed"
    />

    <div
      data-testid="runtime-panel-resizer"
      role="separator"
      tabindex="0"
      aria-label="调整运行状态栏宽度"
      aria-orientation="vertical"
      :aria-valuenow="Math.round(runtimePanelWidth)"
      :aria-valuemin="runtimePanelMinWidth"
      :aria-valuemax="runtimePanelMaxWidth"
      class="group relative z-10 flex w-2 shrink-0 cursor-col-resize justify-center bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="isRuntimePanelResizing ? 'bg-accent' : ''"
      @pointerdown="startRuntimePanelResize"
      @keydown="handleRuntimePanelResizeKeydown"
    >
      <span
        class="h-full w-px bg-border transition-colors group-hover:bg-foreground/30"
        :class="isRuntimePanelResizing ? 'bg-foreground/40' : ''"
        aria-hidden="true"
      />
    </div>

    <aside data-testid="runtime-panel" class="flex shrink-0 flex-col bg-background" :style="runtimePanelStyle">
      <div class="p-3 shadow-[inset_0_-1px_0_0_var(--border)]">
        <div class="grid gap-1.5" :class="pendingApps.length > 0 ? 'grid-cols-3' : 'grid-cols-2'">
          <div class="rounded-md bg-card px-2.5 py-2 shadow-[var(--shadow-border)]">
            <div class="text-[10px] font-medium text-muted-foreground">运行中</div>
            <div class="mt-1 font-mono text-lg font-medium tabular-nums">{{ runningApps.length }}</div>
          </div>
          <div v-if="pendingApps.length > 0" class="rounded-md bg-card px-2.5 py-2 shadow-[var(--shadow-border)]">
            <div class="text-[10px] font-medium text-muted-foreground">即将</div>
            <div class="mt-1 font-mono text-lg font-medium tabular-nums">{{ pendingApps.length }}</div>
          </div>
          <div class="rounded-md bg-card px-2.5 py-2 shadow-[var(--shadow-border)]">
            <div class="text-[10px] font-medium text-muted-foreground">定时</div>
            <div class="mt-1 font-mono text-lg font-medium tabular-nums">{{ scheduledTasks.length }}</div>
          </div>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <section class="space-y-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold tracking-[-0.24px]">
            <Waves :size="13" :stroke-width="2.25" aria-hidden="true" />
            运行中
          </div>
          <div v-if="runningApps.length === 0" class="rounded-md bg-secondary/50 px-3 py-3 text-xs text-muted-foreground">
            暂无运行项
          </div>
          <div v-else class="space-y-1.5">
            <RunningAppCard
              v-for="app in runningApps"
              :key="app.id"
              :app="app"
              :favicon-url="faviconUrl(app)"
              @favicon-error="markFaviconFailed"
            />
          </div>
        </section>

        <section v-if="pendingApps.length > 0" class="mt-5 space-y-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold tracking-[-0.24px]">
            <Timer :size="13" :stroke-width="2.25" aria-hidden="true" />
            即将运行
          </div>
          <div class="space-y-1.5">
            <div
              v-for="app in pendingApps"
              :key="app.id"
              class="rounded-md bg-card px-3 py-2 shadow-[var(--shadow-border)]"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate text-xs font-medium">{{ app.name }}</div>
                  <div class="mt-0.5 font-mono text-[10px] text-muted-foreground">{{ pendingLabel(app) }}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  @click="launcherStore.cancelDelayedLaunch(app.id)"
                >
                  取消
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section class="mt-5 space-y-2" data-testid="recent-runs">
          <div class="flex items-center gap-1.5 text-xs font-semibold tracking-[-0.24px]">
            <History :size="13" :stroke-width="2.25" aria-hidden="true" />
            最近执行
          </div>
          <div v-if="recentRuns.length === 0" class="rounded-md bg-secondary/50 px-3 py-3 text-xs text-muted-foreground">
            暂无最近执行
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="run in recentRuns"
              :key="run.id"
              class="rounded-md px-2.5 py-2 hover:bg-accent"
            >
              <div class="flex items-start gap-2">
                <button
                  type="button"
                  class="min-w-0 flex-1 text-left"
                  @click="openRunLog(run)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="min-w-0 truncate text-xs font-medium">{{ run.app_name }}</span>
                    <span class="shrink-0 text-[10px] font-medium" :class="runRecordStatusClass(run.status, isRunConfirmedRunning(run))">
                      {{ runRecordStatusLabel(run.status, isRunConfirmedRunning(run)) }}
                    </span>
                  </div>
                  <div class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" :title="runCommandLabel(run)">
                    {{ runCommandLabel(run) }}
                  </div>
                  <div class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {{ formatDateTime(run.started_at) }}
                  </div>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  :disabled="!run.command?.trim()"
                  :aria-label="`执行同命令：${run.app_name}`"
                  title="执行同命令"
                  @click="relaunchRunCommand(run)"
                >
                  <Play :size="12" :stroke-width="2.5" aria-hidden="true" />
                  执行
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </aside>

    <DialogFrame
      :open="sessionStore.editDialogOpen"
      :title="appsStore.isNew ? '添加应用' : appsStore.editForm.name || '编辑应用'"
      close-label="关闭编辑"
      panel-class="max-w-4xl"
      content-class="p-0"
      close-on-overlay
      @close="sessionStore.requestCloseEditDialog"
    >
      <AppDetailForm />
    </DialogFrame>

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
