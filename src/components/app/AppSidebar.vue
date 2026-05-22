<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import AppIcon from '@/components/app/AppIcon.vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { itemTypeLabel, runStatusLabel } from '@/lib/appDisplay'
import { formatRunAtTime } from '@/lib/delay'
import type { AppItem, AppType } from '@/lib/store'
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
  <div class="flex w-72 shrink-0 flex-col bg-background shadow-[inset_-1px_0_0_0_var(--border)]">
    <div class="space-y-3 p-3 shadow-[inset_0_-1px_0_0_var(--border)]">
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
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </Button>
      </div>

      <InputGroup class="group h-8">
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
        class="grid w-full grid-cols-4 gap-1"
        :model-value="sidebarFilter"
        type="single"
        aria-label="筛选应用类型"
        @update:model-value="updateSidebarFilter"
      >
        <ToggleGroupItem value="all" class="h-8 px-0" aria-label="显示全部" title="全部">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </ToggleGroupItem>
        <ToggleGroupItem value="web" class="h-8 px-0" aria-label="筛选网页" title="网页">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a15 15 0 0 1 0 18" />
            <path d="M12 3a15 15 0 0 0 0 18" />
          </svg>
        </ToggleGroupItem>
        <ToggleGroupItem value="service" class="h-8 px-0" aria-label="筛选服务" title="服务">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
            <path d="M7 7v10" />
          </svg>
        </ToggleGroupItem>
        <ToggleGroupItem value="task" class="h-8 px-0" aria-label="筛选任务" title="任务">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4l3 2" />
          </svg>
        </ToggleGroupItem>
      </ToggleGroup>

    </div>

    <div class="flex-1 overflow-y-auto py-2">
      <div v-if="filteredApps.length === 0" class="px-4 py-8 text-xs text-muted-foreground">
        没有匹配的应用
      </div>

      <div class="space-y-0.5 px-2">
        <div
          v-for="app in filteredApps"
          :key="app.id"
        >
          <Button
            type="button"
            variant="ghost"
            class="relative h-auto w-full justify-start gap-2.5 px-2 py-2 text-left cursor-grab select-none touch-none active:cursor-grabbing"
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
              <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div class="truncate text-sm">{{ app.name }}</div>
                <span
                  v-if="primaryStatusLabel(app)"
                  class="rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
                  :class="primaryStatusClass(app)"
                >
                  {{ primaryStatusLabel(app) }}
                </span>
              </div>
              <div class="mt-0.5 truncate text-[10px] text-muted-foreground">
                {{ sidebarSubtitle(app) || '未配置命令' }}
              </div>
            </div>
          </Button>
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
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="8.5" y="14" width="7" height="7" rx="1.5" />
          <path d="M10 6.5h4" />
          <path d="M6.5 10v2a2 2 0 0 0 2 2h3.5" />
          <path d="M17.5 10v2a2 2 0 0 1-2 2H12" />
        </svg>
        <span class="text-xs">进程排查</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="h-8 w-full justify-center gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        title="设置"
        @click="settingsStore.openSettingsDialog"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        <span class="text-xs">设置</span>
      </Button>
    </div>
  </div>
</template>
