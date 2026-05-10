<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import AppCapabilityStack from '@/components/app/capabilities/AppCapabilityStack.vue'
import LaunchActionGroup from '@/components/app/LaunchActionGroup.vue'
import { formatDelayLabel, formatRunAtTime } from '@/lib/delay'
import {
  iconGradient,
  itemTypeLabel,
  primaryActionLabel,
  runStatusClass,
  runStatusLabel,
  statusDotClass,
} from '@/lib/appDisplay'
import type { AppItem, AppType, MissedPolicy, RestartConfig, RetryConfig, StartupConfig } from '@/lib/store'
import type { LaunchOptions, PendingLaunch, RunRecord } from '@/composables/useLauncher'

const editForm = defineModel<AppItem>({ required: true })

const props = defineProps<{
  isNew: boolean
  runningAppIds: Set<string>
  runningPids: Map<string, number>
  latestRuns: Map<string, RunRecord>
  pendingLaunches: Map<string, PendingLaunch>
}>()

const emit = defineEmits<{
  save: []
  duplicate: []
  launch: [app: AppItem, options?: LaunchOptions]
  cancelDelayedLaunch: [appId: string]
  delete: []
  setType: [type: AppType]
  setScheduleEnabled: [enabled: boolean]
  setMissedPolicy: [missedPolicy: MissedPolicy]
  setScheduleCron: [cron: string]
  setStartup: [startup: StartupConfig]
  setRestart: [restart: RestartConfig]
  setRetry: [retry: RetryConfig]
  chooseWorkingDirectory: []
  showWindow: [appId: string]
  openLog: [app: AppItem]
  stop: [appId: string]
}>()

const pendingLaunch = computed(() => props.pendingLaunches.get(editForm.value.id) || null)

function emitLaunch(delaySeconds?: number) {
  if (delaySeconds) emit('launch', editForm.value, { delaySeconds })
  else emit('launch', editForm.value)
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div data-testid="app-detail-panel" class="mx-auto max-w-[780px] px-8 py-8">
      <div class="overflow-hidden rounded-lg bg-card" style="box-shadow: var(--shadow-card)">
        <div class="px-5 py-4 shadow-[inset_0_-1px_0_0_var(--border)]">
          <div class="flex min-h-[64px] items-center gap-4">
            <div
              v-if="!props.isNew && editForm.name"
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-semibold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
              :class="iconGradient(editForm.name)"
            >
              {{ editForm.name.charAt(0).toUpperCase() }}
            </div>
            <div v-else class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground shadow-[var(--shadow-border)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-base font-semibold tracking-[-0.32px]">
                {{ props.isNew ? '添加应用' : editForm.name || '未命名' }}
              </h2>
              <div v-if="!props.isNew" class="mt-1.5 flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" :class="runStatusClass(editForm, props.runningAppIds, props.latestRuns)">
                  <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(editForm, props.runningAppIds, props.latestRuns)" />
                  {{ runStatusLabel(editForm, props.runningAppIds, props.latestRuns) || itemTypeLabel(editForm.type) }}
                </span>
                <span v-if="props.runningPids.has(editForm.id)" class="font-mono text-[11px] text-muted-foreground">PID {{ props.runningPids.get(editForm.id) }}</span>
                <Button v-if="editForm.type === 'web' && props.runningAppIds.has(editForm.id)" type="button" variant="secondary" class="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground" @click="$emit('showWindow', editForm.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
                  窗口
                </Button>
                <Button v-if="editForm.command" type="button" variant="secondary" class="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground" @click="$emit('openLog', editForm)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                  日志
                </Button>
                <Button v-if="props.runningAppIds.has(editForm.id)" type="button" variant="secondary" class="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive" @click="$emit('stop', editForm.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
                  停止
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div class="px-5 py-5">
          <AppCapabilityStack
            v-model="editForm"
            @set-type="$emit('setType', $event)"
            @set-schedule-enabled="$emit('setScheduleEnabled', $event)"
            @set-schedule-cron="$emit('setScheduleCron', $event)"
            @set-missed-policy="$emit('setMissedPolicy', $event)"
            @set-startup="$emit('setStartup', $event)"
            @set-restart="$emit('setRestart', $event)"
            @set-retry="$emit('setRetry', $event)"
            @choose-working-directory="$emit('chooseWorkingDirectory')"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 bg-muted/40 px-5 py-3 shadow-[inset_0_1px_0_0_var(--border)]">
          <Button size="sm" @click="$emit('save')">{{ props.isNew ? '添加' : '保存' }}</Button>
          <Button
            v-if="!props.isNew"
            variant="secondary"
            size="sm"
            @click="$emit('duplicate')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V7a2 2 0 0 1 2-2h8" />
            </svg>
            复制
          </Button>
          <LaunchActionGroup
            v-if="!props.isNew"
            :label="primaryActionLabel(editForm)"
            @launch="emitLaunch"
          />
          <div
            v-if="pendingLaunch"
            class="flex h-7 items-center gap-2 rounded-md bg-secondary px-2 text-[11px] text-muted-foreground shadow-[var(--shadow-border)]"
          >
            <span>
              {{ formatDelayLabel(pendingLaunch.delaySeconds) }}后 · {{ formatRunAtTime(pendingLaunch.runAt) }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-1.5 text-[11px]"
              @click="$emit('cancelDelayedLaunch', editForm.id)"
            >
              取消
            </Button>
          </div>
          <div class="flex-1" />
          <Button v-if="!props.isNew" variant="destructive" size="sm" @click="$emit('delete')">删除</Button>
        </div>
      </div>
    </div>
  </div>
</template>
