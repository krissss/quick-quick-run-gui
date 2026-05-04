<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { RunRecord } from '@/composables/useLauncher'
import { formatDateTime, formatDuration } from '@/lib/time'

const props = defineProps<{
  open: boolean
  appId: string
  appName: string
  lines: string[]
  runs: RunRecord[]
  selectedRunId: string | null
  launchFailed: boolean
  launchFailedReason: string
  windowOpened: boolean
  runningAppIds: Set<string>
}>()

defineEmits<{
  close: []
  relaunch: [appId: string]
  selectRun: [runId: string | null]
  clearSelected: []
  clearAll: []
}>()

const logContainer = ref<HTMLElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

watch(() => props.lines.length, scrollToBottom)
watch(() => props.open, (open) => {
  if (open) scrollToBottom()
})

const selectedRun = computed(() => props.runs.find(run => run.id === props.selectedRunId))
const hasClearableRuns = computed(() => props.runs.some(run => run.status !== 'running'))
const canClearSelected = computed(() => !!selectedRun.value && selectedRun.value.status !== 'running')

function runStatusLabel(status: RunRecord['status']) {
  if (status === 'running') return '运行中'
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'killed') return '已停止'
  return '丢失'
}

function runStatusClass(status: RunRecord['status']) {
  if (status === 'running') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'success') return 'text-foreground'
  if (status === 'failed' || status === 'lost') return 'text-destructive'
  return 'text-muted-foreground'
}

function triggerLabel(trigger: RunRecord['trigger']) {
  if (trigger === 'schedule') return '定时'
  if (trigger === 'delayed') return '延迟'
  if (trigger === 'startup') return '启动'
  if (trigger === 'auto-restart') return '重启'
  if (trigger === 'retry') return '重试'
  if (trigger === 'startup-recover') return '恢复'
  return '手动'
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      @click.self="$emit('close')"
    >
      <div class="bg-card rounded-lg p-6 w-full max-w-5xl max-h-[84vh] flex flex-col" style="box-shadow: var(--shadow-card)">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-semibold tracking-[-0.32px]">{{ appName }} — 日志</h2>
          <div v-if="!launchFailed && !windowOpened && runningAppIds.has(appId)" class="flex items-center gap-1.5">
            <span class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span class="text-xs text-muted-foreground">启动中</span>
          </div>
          <span v-if="launchFailed" class="text-xs text-destructive font-medium">
            {{ launchFailedReason === 'process_exited' ? '进程已退出' : '启动超时' }}
          </span>
        </div>
        <div class="grid min-h-0 flex-1 gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
          <div
            v-if="runs.length > 0"
            class="min-h-0 overflow-y-auto rounded-md bg-secondary/50 p-2"
            style="box-shadow: inset 0 0 0 1px var(--border)"
          >
            <div class="px-2 pb-2 text-xs font-medium text-muted-foreground">最近运行</div>
            <button
              v-for="run in runs"
              :key="run.id"
              type="button"
              class="mb-1 w-full rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-background"
              :class="run.id === selectedRunId ? 'bg-background shadow-[var(--shadow-border)]' : 'text-muted-foreground'"
              @click="$emit('selectRun', run.id)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium" :class="runStatusClass(run.status)">{{ runStatusLabel(run.status) }}</span>
                <span class="shrink-0 text-[11px] text-muted-foreground">{{ triggerLabel(run.trigger) }}</span>
              </div>
              <div class="mt-1 font-mono text-[11px] text-muted-foreground">{{ formatDateTime(run.started_at) }}</div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">
                {{ formatDuration(run.started_at, run.finished_at) }}
                <span v-if="run.exit_code != null"> · code {{ run.exit_code }}</span>
              </div>
            </button>
          </div>
          <div
            ref="logContainer"
            class="min-h-[360px] overflow-y-auto bg-background rounded-md p-4 font-mono text-xs"
            :class="runs.length > 0 ? 'min-h-0' : 'col-span-full'"
            style="box-shadow: inset 0 0 0 1px var(--border)"
          >
            <div v-for="(line, i) in lines" :key="i" class="whitespace-pre-wrap break-all text-foreground/80 hover:text-foreground">{{ line }}</div>
            <div v-if="lines.length === 0" class="text-muted-foreground text-center py-10">暂无日志</div>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            :disabled="!canClearSelected"
            @click="$emit('clearSelected')"
          >
            清理当前
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="!hasClearableRuns"
            @click="$emit('clearAll')"
          >
            清理全部
          </Button>
          <div class="flex-1" />
          <Button v-if="launchFailed" variant="destructive" size="sm" @click="$emit('relaunch', appId)">重新启动</Button>
          <Button variant="secondary" size="sm" @click="$emit('close')">关闭</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
