<script setup lang="ts">
import { computed, ref } from 'vue'
import { Clock, Edit3, FileText, Grid2x2, Globe, InspectionPanel, List, Monitor, Plus, RefreshCcw, Search, Settings, Square, X, Zap } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import AppIcon from '@/components/app/AppIcon.vue'
import LaunchActionGroup from '@/components/app/LaunchActionGroup.vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { itemTypeLabel, runStatusLabel } from '@/lib/appDisplay'
import { formatRunAtTime } from '@/lib/delay'
import { parseCommandSignature, type AppItem, type AppProfile, type AppType } from '@/lib/store'
import { useAppSessionStore } from '@/stores/appSession'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore } from '@/stores/launcher'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  faviconUrl: (app: AppItem) => string
}>()

const emit = defineEmits<{
  'favicon-error': [app: AppItem]
}>()

const appsStore = useAppsStore()
const launcherStore = useLauncherStore()
const settingsStore = useSettingsStore()
const sessionStore = useAppSessionStore()

const sidebarSearch = ref('')
const sidebarFilter = ref<'all' | AppType>('all')

const filteredApps = computed(() => {
  const query = sidebarSearch.value.trim().toLowerCase()
  return appsStore.apps.filter((app) => {
    if (sidebarFilter.value !== 'all' && app.type !== sidebarFilter.value) return false
    if (!query) return true
    const profileText = app.profiles
      .flatMap(profile => [profile.name, ...Object.values(profile.values || {})])
      .join(' ')
    const haystack = [app.name, app.command, app.workingDirectory, app.url, profileText, itemTypeLabel(app.type)].join(' ').toLowerCase()
    return haystack.includes(query)
  })
})

const runningCount = computed(() => launcherStore.runningCount(appsStore.apps))

const draggedAppId = ref<string | null>(null)
const dragOverAppId = ref<string | null>(null)
const dragPointerId = ref<number | null>(null)
const dragStartPoint = ref<{ x: number; y: number; appId: string } | null>(null)
const suppressClickAppId = ref<string | null>(null)
let suppressClickTimer: ReturnType<typeof setTimeout> | null = null
const dragThreshold = 6

function updateSidebarFilter(value: string | string[]) {
  if (Array.isArray(value) || !value) return
  if (value === 'all' || value === 'web' || value === 'service' || value === 'task') {
    sidebarFilter.value = value
  }
}

function clearSidebarSearch() {
  sidebarSearch.value = ''
}

function appIdFromPoint(x: number, y: number) {
  const element = document.elementFromPoint(x, y)
  const row = element?.closest('[data-app-id]') as HTMLElement | null
  return row?.dataset.appId || null
}

function resetAppDrag() {
  draggedAppId.value = null
  dragOverAppId.value = null
  dragPointerId.value = null
  dragStartPoint.value = null
}

function handleAppPointerDown(event: PointerEvent, appId: string) {
  if (event.button !== 0) return
  dragStartPoint.value = { x: event.clientX, y: event.clientY, appId }
  dragOverAppId.value = null
  dragPointerId.value = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function handleAppPointerMove(event: PointerEvent) {
  if (dragPointerId.value !== event.pointerId || !dragStartPoint.value) return
  const distance = Math.hypot(
    event.clientX - dragStartPoint.value.x,
    event.clientY - dragStartPoint.value.y,
  )
  if (!draggedAppId.value && distance < dragThreshold) return
  if (!draggedAppId.value) draggedAppId.value = dragStartPoint.value.appId
  event.preventDefault()
  const targetId = appIdFromPoint(event.clientX, event.clientY)
  dragOverAppId.value = targetId && targetId !== draggedAppId.value ? targetId : null
}

function handleAppPointerUp(event: PointerEvent) {
  if (dragPointerId.value !== event.pointerId || !dragStartPoint.value) return
  const activeId = dragStartPoint.value.appId
  const hasDragged = !!draggedAppId.value
  const targetId = dragOverAppId.value || appIdFromPoint(event.clientX, event.clientY)
  if (hasDragged) {
    event.preventDefault()
    suppressClickAppId.value = activeId
    if (suppressClickTimer) clearTimeout(suppressClickTimer)
    suppressClickTimer = window.setTimeout(() => {
      if (suppressClickAppId.value === activeId) suppressClickAppId.value = null
      suppressClickTimer = null
    }, 0)
  }
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  if (hasDragged && targetId && activeId !== targetId) void appsStore.reorderApps(activeId, targetId)
  resetAppDrag()
}

function handleAppClick(event: MouseEvent, app: AppItem) {
  if (suppressClickAppId.value === app.id) {
    event.preventDefault()
    event.stopPropagation()
    suppressClickAppId.value = null
    if (suppressClickTimer) {
      clearTimeout(suppressClickTimer)
      suppressClickTimer = null
    }
    return
  }
  void sessionStore.selectApp(app)
}

function handleAppKeydown(event: KeyboardEvent, app: AppItem) {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  void sessionStore.selectApp(app)
}

function handleAppDoubleClick(event: MouseEvent, app: AppItem) {
  if (suppressClickAppId.value === app.id) return
  event.preventDefault()
  void sessionStore.openEditor(app)
}

function handleOpenEditor(app: AppItem) {
  void sessionStore.openEditor(app)
}

function handleLaunch(app: AppItem, delaySeconds?: number) {
  void sessionStore.requestLaunch(app, delaySeconds ? { delaySeconds } : {})
}

function handleLaunchActiveProfile(app: AppItem) {
  void launcherStore.launchApp(app)
}

function handleStop(app: AppItem) {
  void launcherStore.stopApp(app.id)
}

function handleRestart(app: AppItem) {
  void launcherStore.restartApp(app)
}

function handleShowWindow(app: AppItem) {
  void launcherStore.showAppWindow(app.id)
}

function handleOpenLog(app: AppItem) {
  void sessionStore.openExistingLogDialog(app)
}

function isRunning(app: AppItem) {
  return launcherStore.appRunState(app.id).isRunning
}

function isRestartable(app: AppItem) {
  return isRunning(app) && (app.type === 'web' || app.type === 'service')
}

function isRestarting(app: AppItem) {
  return launcherStore.appRunState(app.id).isRestarting
}

function hasLogSource(app: AppItem) {
  return launcherStore.hasLogSource(app)
}

function activeProfile(app: AppItem): AppProfile | null {
  return app.profiles.find(profile => profile.id === app.activeProfileId) || null
}

function hasActiveCommandProfile(app: AppItem) {
  return parseCommandSignature(app.command).params.length > 0 && !!activeProfile(app)
}

function commandTemplateLabel(app: AppItem) {
  if (parseCommandSignature(app.command).params.length === 0) return ''
  return activeProfile(app)?.name?.trim() || '默认'
}

function activeProfileLaunchTitle(app: AppItem) {
  const name = activeProfile(app)?.name?.trim() || '当前方案'
  return `立即运行当前方案：${name}`
}

function sidebarSubtitle(app: AppItem) {
  const value = app.type === 'web'
    ? app.url || app.command || app.workingDirectory
    : app.command || app.workingDirectory || app.url
  return value.replace(/^https?:\/\//, '')
}

function latestRunLabel(app: AppItem) {
  const runState = launcherStore.appRunState(app.id)
  if (runState.isRunning) return ''
  const label = runStatusLabel(app, launcherStore.runningAppIds, launcherStore.latestRuns)
  return label === '上次成功' ? '成功' : label
}

function primaryStatusLabel(app: AppItem) {
  const runState = launcherStore.appRunState(app.id)
  if (runState.pendingLaunch) return `即将 ${formatRunAtTime(runState.pendingLaunch.runAt)}`
  if (runState.isRunning) return '运行中'
  const run = runState.latestRun
  if (run?.status === 'failed') return '失败'
  if (run?.status === 'lost') return '丢失'
  if (app.type === 'task' && app.schedule.enabled) return '定时'
  if (latestRunLabel(app)) return latestRunLabel(app)
  return ''
}

function primaryStatusClass(app: AppItem) {
  const runState = launcherStore.appRunState(app.id)
  if (runState.pendingLaunch) return 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
  if (runState.isRunning) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  const status = runState.latestRun?.status
  if (status === 'failed' || status === 'lost') return 'bg-destructive/10 text-destructive'
  if (app.type === 'task' && app.schedule.enabled) return 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
  return 'bg-secondary text-muted-foreground'
}

</script>

<template>
  <div class="flex min-w-[24rem] flex-1 flex-col bg-background shadow-[inset_-1px_0_0_0_var(--border)]">
    <div class="space-y-2.5 p-3 shadow-[inset_0_-1px_0_0_var(--border)]">
      <div class="flex items-start justify-between gap-3 px-1">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold tracking-[-0.28px]">QQRun</div>
          <div class="mt-0.5 text-xs text-muted-foreground">
            {{ appsStore.apps.length }} 个条目 · {{ runningCount }} 个运行中
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          :class="appsStore.isNew ? 'bg-card text-foreground shadow-[var(--shadow-border)]' : ''"
          aria-label="添加应用"
          title="添加应用"
          @click="sessionStore.openAddForm"
        >
          <Plus :size="14" :stroke-width="2.25" aria-hidden="true" />
        </Button>
      </div>

      <div class="flex items-center gap-2">
        <InputGroup class="group h-8 flex-1 min-w-0">
          <InputGroupAddon>
            <Search class="h-3.5 w-3.5" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            v-model="sidebarSearch"
            class="h-8 px-2 text-xs"
            placeholder="搜索名称、命令或 URL"
            aria-label="搜索应用"
          />
          <InputGroupAddon v-if="sidebarSearch" align="inline-end">
            <InputGroupButton
              class="h-6 w-6 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
              aria-label="清空搜索"
              title="清空搜索"
              @mousedown.prevent.stop
              @click.prevent.stop="clearSidebarSearch"
            >
              <X class="h-3 w-3" aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <ToggleGroup
          class="grid w-[8.5rem] shrink-0 grid-cols-4 gap-1"
          :model-value="sidebarFilter"
          type="single"
          aria-label="筛选应用类型"
          @update:model-value="updateSidebarFilter"
        >
          <ToggleGroupItem value="all" class="h-8 px-0" aria-label="显示全部" title="全部">
            <Grid2x2 :size="13" :stroke-width="2" aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="web" class="h-8 px-0" aria-label="筛选网页" title="网页">
            <Globe :size="13" :stroke-width="2" aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="service" class="h-8 px-0" aria-label="筛选服务" title="服务">
            <List :size="13" :stroke-width="2" aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="task" class="h-8 px-0" aria-label="筛选任务" title="任务">
            <Clock :size="13" :stroke-width="2" aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <div v-if="filteredApps.length === 0" class="px-4 py-8 text-xs text-muted-foreground">
        没有匹配的应用
      </div>

      <div class="space-y-1 px-2">
        <div
          v-for="app in filteredApps"
          :key="app.id"
          class="relative"
        >
          <div
            role="button"
            tabindex="0"
            class="relative flex h-auto w-full cursor-grab select-none justify-start gap-2 rounded-md px-2 py-2 text-left transition-all touch-none active:cursor-grabbing"
            :class="[
              appsStore.editForm.id === app.id && !appsStore.isNew ? 'bg-card text-foreground shadow-[var(--shadow-border)]' : 'text-foreground hover:bg-accent/50',
              draggedAppId === app.id ? 'opacity-50' : '',
              dragOverAppId === app.id ? 'bg-accent/70 shadow-[inset_0_0_0_1px_var(--ring)]' : '',
            ]"
            :data-app-id="app.id"
            :title="`拖动排序：${app.name}`"
            @pointerdown="handleAppPointerDown($event, app.id)"
            @pointermove="handleAppPointerMove"
            @pointerup="handleAppPointerUp"
            @pointercancel="resetAppDrag"
            @click="handleAppClick($event, app)"
            @dblclick="handleAppDoubleClick($event, app)"
            @keydown="handleAppKeydown($event, app)"
          >
            <span
              v-if="appsStore.editForm.id === app.id && !appsStore.isNew"
              class="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-foreground/70"
              aria-hidden="true"
            />
            <AppIcon
              :app="app"
              :favicon-url="faviconUrl(app)"
              size="sm"
              @favicon-error="emit('favicon-error', app)"
            />
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <div class="min-w-[8rem] flex-1 truncate text-sm font-medium">{{ app.name }}</div>
                <div class="flex shrink-0 flex-wrap items-center justify-end gap-1" @dblclick.stop>
                  <span class="inline-flex items-center gap-0.5 rounded bg-secondary/70 p-0.5 shadow-[var(--shadow-border)]">
                    <button
                      v-if="isRunning(app)"
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                      :aria-label="`停止：${app.name}`"
                      title="停止"
                      @pointerdown.stop
                      @click.stop="handleStop(app)"
                    >
                      <Square class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <LaunchActionGroup
                      v-else
                      :label="`${app.type === 'task' ? '运行' : '启动'}：${app.name}`"
                      size="row"
                      @pointerdown.stop
                      @click.stop
                      @launch="(delaySeconds) => handleLaunch(app, delaySeconds)"
                    />
                    <button
                      v-if="!isRunning(app) && hasActiveCommandProfile(app)"
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      :aria-label="`立即运行当前方案：${app.name}`"
                      :title="activeProfileLaunchTitle(app)"
                      @pointerdown.stop
                      @click.stop="handleLaunchActiveProfile(app)"
                    >
                      <Zap class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      v-if="isRestartable(app)"
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isRestarting(app)"
                      :aria-label="`重启：${app.name}`"
                      title="重启"
                      @pointerdown.stop
                      @click.stop="handleRestart(app)"
                    >
                      <RefreshCcw class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      v-if="app.type === 'web' && isRunning(app)"
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      :aria-label="`打开窗口：${app.name}`"
                      title="打开窗口"
                      @pointerdown.stop
                      @click.stop="handleShowWindow(app)"
                    >
                      <Monitor class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      v-if="hasLogSource(app)"
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      :aria-label="`查看日志：${app.name}`"
                      title="查看日志"
                      @pointerdown.stop
                      @click.stop="handleOpenLog(app)"
                    >
                      <FileText class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                  <span class="inline-flex items-center gap-0.5 rounded bg-secondary/70 p-0.5 shadow-[var(--shadow-border)]">
                    <button
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      :aria-label="`编辑：${app.name}`"
                      title="编辑"
                      @pointerdown.stop
                      @click.stop="handleOpenEditor(app)"
                    >
                      <Edit3 class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </div>
              <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                <span
                  v-if="primaryStatusLabel(app)"
                  class="rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
                  :class="primaryStatusClass(app)"
                >
                  {{ primaryStatusLabel(app) }}
                </span>
                <span class="truncate text-[10px] text-muted-foreground">{{ itemTypeLabel(app.type) }}</span>
                <span
                  v-if="commandTemplateLabel(app)"
                  class="inline-flex max-w-[9rem] items-center rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground shadow-[var(--shadow-border)]"
                  :title="`当前方案：${commandTemplateLabel(app)}`"
                >
                  <span class="truncate">方案：{{ commandTemplateLabel(app) }}</span>
                </span>
              </div>
              <div class="mt-0.5 truncate text-[10px] text-muted-foreground">
                {{ sidebarSubtitle(app) || '未配置命令' }}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-1.5 p-2 shadow-[inset_0_1px_0_0_var(--border)]">
      <Button
        type="button"
        variant="ghost"
        class="h-8 w-full justify-center gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        title="进程排查"
        @click="sessionStore.openPortManagerDialog"
      >
        <InspectionPanel :size="14" :stroke-width="2" aria-hidden="true" />
        <span class="text-xs">进程排查</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="h-8 w-full justify-center gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        title="设置"
        @click="settingsStore.openSettingsDialog"
      >
        <Settings :size="14" :stroke-width="2" aria-hidden="true" />
        <span class="text-xs">设置</span>
      </Button>
    </div>
  </div>
</template>
