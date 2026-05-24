<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/app/AppIcon.vue'
import LogConsole from '@/components/app/LogConsole.vue'
import { itemTypeLabel } from '@/lib/appDisplay'
import { resolveAppProfile, type AppItem } from '@/lib/store'
import { useLogPreview } from '@/composables/useLogPreview'
import { useAppSessionStore } from '@/stores/appSession'
import { useLauncherStore } from '@/stores/launcher'

const props = defineProps<{
  app: AppItem
  faviconUrl: string
}>()

const emit = defineEmits<{
  'favicon-error': [app: AppItem]
}>()

const launcherStore = useLauncherStore()
const sessionStore = useAppSessionStore()

const runState = computed(() => launcherStore.appRunState(props.app.id))
const isRunning = computed(() => runState.value.isRunning)
const hasLogSource = computed(() => launcherStore.hasLogSource(props.app))
const appId = computed(() => props.app.id)
const activeRunCommand = computed(() => runState.value.latestRun?.command?.trim() || '')
const configuredCommand = computed(() => resolveAppProfile(props.app).command.trim())
const commandLabel = computed(() =>
  activeRunCommand.value || configuredCommand.value || props.app.url || props.app.workingDirectory || '未配置命令',
)
const { previewLines } = useLogPreview(appId, isRunning, hasLogSource)
const showLogPreview = computed(() => hasLogSource.value && previewLines.value.length > 0)

function openFullLog() {
  void sessionStore.openExistingLogDialog(props.app, runState.value.latestRun?.id)
}
</script>

<template>
  <div class="rounded-md bg-card p-2 shadow-[var(--shadow-border)]" data-testid="running-app-card">
    <div class="flex items-start gap-2">
      <AppIcon
        :app="app"
        :favicon-url="faviconUrl"
        size="sm"
        @favicon-error="emit('favicon-error', app)"
      />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0 flex-1 truncate text-xs font-medium">{{ app.name }}</div>
          <span class="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-600 dark:text-emerald-400">
            运行中
          </span>
        </div>
        <div class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          PID {{ runState.pid ?? '-' }} · {{ itemTypeLabel(app.type) }}
        </div>
      </div>
    </div>

    <div class="mt-2 rounded bg-secondary/50 px-2 py-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
      <div class="truncate" :title="commandLabel">{{ commandLabel }}</div>
    </div>

    <div v-if="showLogPreview" class="mt-2 space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <div class="text-[10px] font-medium text-muted-foreground">日志</div>
        <button
          type="button"
          class="h-5 shrink-0 rounded px-1.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          :aria-label="`查看全部日志：${app.name}`"
          title="查看全部日志"
          @click="openFullLog"
        >
          查看全部
        </button>
      </div>
      <LogConsole :lines="previewLines" size="preview" />
    </div>
  </div>
</template>
