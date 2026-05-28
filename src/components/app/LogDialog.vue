<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { DialogFrame } from '@/components/ui/dialog-frame'
import LogConsole from '@/components/app/LogConsole.vue'
import { useAppSessionStore } from '@/stores/appSession'
import { useLauncherStore } from '@/stores/launcher'
import { useLogsStore } from '@/stores/logs'
import type { RunRecord } from '@/stores/launcher'
import { runRecordStatusClass, runRecordStatusLabel } from '@/lib/appDisplay'
import { formatDateTime, formatDuration } from '@/lib/time'

const logsStore = useLogsStore()
const launcherStore = useLauncherStore()
const sessionStore = useAppSessionStore()

const logConsoleRef = ref<InstanceType<typeof LogConsole> | null>(null)

function scrollToBottom() {
  nextTick(() => {
    logConsoleRef.value?.scrollToBottom()
  })
}

watch(() => logsStore.logLines.length, scrollToBottom)
watch(() => logsStore.showLogDialog, (open) => {
  if (open) scrollToBottom()
})

const selectedRun = computed(() => logsStore.logRuns.find(run => run.id === logsStore.selectedLogRunId))
const hasClearableRuns = computed(() => logsStore.logRuns.some(run => run.status !== 'running'))
const canClearSelected = computed(() => !!selectedRun.value && selectedRun.value.status !== 'running')
const isCurrentAppRunning = computed(() => launcherStore.appRunState(logsStore.logAppId).isRunning)

function isRunConfirmedRunning(run: RunRecord) {
  return run.status === 'running' && launcherStore.runningAppIds.has(run.app_id)
}

function runDurationLabel(run: RunRecord) {
  if (run.status === 'running' && !isRunConfirmedRunning(run)) return '待确认'
  return formatDuration(run.started_at, run.finished_at)
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

function runCommandLabel(run: RunRecord) {
  return run.command?.trim() || '未记录命令'
}
</script>

<template>
  <DialogFrame
    :open="logsStore.showLogDialog"
    :title="`${logsStore.logAppName} — 日志`"
    close-label="关闭日志"
    panel-class="h-[min(calc(100dvh-2rem),42rem)] max-h-[calc(100dvh-2rem)] max-w-5xl"
    content-class="flex min-h-0 flex-1 flex-col overflow-hidden"
    footer-class="shrink-0 flex-wrap"
    @close="logsStore.closeLogDialog"
  >
    <template #header-actions>
      <div v-if="!logsStore.logLaunchFailed && !logsStore.logWindowOpened && isCurrentAppRunning" class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span class="text-xs text-muted-foreground">启动中</span>
      </div>
      <span v-if="logsStore.logLaunchFailed" class="text-xs text-destructive font-medium">
        {{ logsStore.logLaunchFailedReason === 'process_exited' ? '进程已退出' : '启动超时' }}
      </span>
    </template>

    <div
      data-testid="log-dialog-body"
      class="flex min-h-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1"
    >
      <div
        v-if="logsStore.logRuns.length > 0"
        data-testid="log-run-list"
        class="max-h-36 min-h-0 shrink-0 overflow-y-auto rounded-md bg-secondary/50 p-2 md:max-h-none md:shrink"
        style="box-shadow: inset 0 0 0 1px var(--border)"
      >
        <div class="px-2 pb-2 text-xs font-medium text-muted-foreground">最近运行</div>
        <button
          v-for="run in logsStore.logRuns"
          :key="run.id"
          type="button"
          class="mb-1 w-full rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-background"
          :class="run.id === logsStore.selectedLogRunId ? 'bg-background shadow-[var(--shadow-border)]' : 'text-muted-foreground'"
          @click="logsStore.selectLogRun(run.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium" :class="runRecordStatusClass(run.status, isRunConfirmedRunning(run))">
              {{ runRecordStatusLabel(run.status, isRunConfirmedRunning(run)) }}
            </span>
            <span class="shrink-0 text-[11px] text-muted-foreground">{{ triggerLabel(run.trigger) }}</span>
          </div>
          <div class="mt-1 truncate font-mono text-[11px] text-muted-foreground" :title="runCommandLabel(run)">
            {{ runCommandLabel(run) }}
          </div>
          <div class="mt-1 font-mono text-[11px] text-muted-foreground">{{ formatDateTime(run.started_at) }}</div>
          <div class="mt-0.5 text-[11px] text-muted-foreground">
            {{ runDurationLabel(run) }}
            <span v-if="run.exit_code != null"> · code {{ run.exit_code }}</span>
          </div>
        </button>
      </div>
      <LogConsole
        ref="logConsoleRef"
        data-testid="log-lines"
        :lines="logsStore.logLines"
        size="dialog"
        :class="logsStore.logRuns.length > 0 ? 'min-h-0' : 'col-span-full'"
      />
    </div>

    <template #footer>
      <Button
        variant="ghost"
        size="sm"
        :disabled="!canClearSelected"
        @click="logsStore.clearSelectedLogRun"
      >
        清理当前
      </Button>
      <Button
        variant="ghost"
        size="sm"
        :disabled="!hasClearableRuns"
        @click="logsStore.clearAllLogRuns"
      >
        清理全部
      </Button>
      <div class="flex-1" />
      <Button v-if="isCurrentAppRunning" variant="destructive" size="sm" @click="launcherStore.stopApp(logsStore.logAppId)">停止</Button>
      <Button v-if="logsStore.logLaunchFailed" variant="destructive" size="sm" @click="sessionStore.relaunchFromLog(logsStore.logAppId)">重新启动</Button>
      <Button variant="secondary" size="sm" @click="logsStore.closeLogDialog">关闭</Button>
    </template>
  </DialogFrame>
</template>
