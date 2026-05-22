<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import AppCapabilityStack from '@/components/app/capabilities/AppCapabilityStack.vue'
import AppIcon from '@/components/app/AppIcon.vue'
import LaunchActionGroup from '@/components/app/LaunchActionGroup.vue'
import {
  itemTypeLabel,
  primaryActionLabel,
  runStatusClass,
  runStatusLabel,
  statusDotClass,
} from '@/lib/appDisplay'
import type { AppItem } from '@/lib/store'
import { useAppSessionStore } from '@/stores/appSession'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore } from '@/stores/launcher'
import { useLogPreview } from '@/composables/useLogPreview'

const props = defineProps<{
  faviconUrl?: string
}>()

const emit = defineEmits<{
  'favicon-error': [app: AppItem]
}>()

const appsStore = useAppsStore()
const launcherStore = useLauncherStore()
const sessionStore = useAppSessionStore()
const editForm = computed<AppItem>({
  get: () => appsStore.editForm,
  set: value => {
    appsStore.updateForm(value)
  },
})

const runState = computed(() => launcherStore.appRunState(editForm.value.id))
const pendingLaunch = computed(() => runState.value.pendingLaunch)
const isRunning = computed(() => runState.value.isRunning)
const isRestartable = computed(() => isRunning.value && (editForm.value.type === 'web' || editForm.value.type === 'service'))
const isRestarting = computed(() => runState.value.isRestarting)

const appId = computed(() => editForm.value.id)
const hasLogSource = computed(() => launcherStore.hasLogSource(editForm.value))
const { previewLines } = useLogPreview(appId, isRunning, hasLogSource)
const showLogPreview = computed(() => isRunning.value && hasLogSource.value && previewLines.value.length > 0)

function emitLaunch(delaySeconds?: number) {
  if (delaySeconds) void sessionStore.requestLaunch(editForm.value, { delaySeconds })
  else void sessionStore.requestLaunch(editForm.value)
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div data-testid="app-detail-panel" class="mx-auto max-w-[780px] px-8 py-8">
      <div class="rounded-lg bg-card" style="box-shadow: var(--shadow-card)">
        <div class="px-5 py-4 shadow-[inset_0_-1px_0_0_var(--border)]">
          <div class="flex min-h-[64px] items-start gap-4">
            <AppIcon
              :app="editForm"
              :favicon-url="props.faviconUrl || ''"
              :is-new="appsStore.isNew"
              size="lg"
              @favicon-error="emit('favicon-error', editForm)"
            />
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-base font-semibold tracking-[-0.32px]">
                {{ appsStore.isNew ? '添加应用' : editForm.name || '未命名' }}
              </h2>
              <div v-if="!appsStore.isNew" class="mt-1.5 flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" :class="runStatusClass(editForm, launcherStore.runningAppIds, launcherStore.latestRuns)">
                  <span class="h-1.5 w-1.5 rounded-full" :class="statusDotClass(editForm, launcherStore.runningAppIds, launcherStore.latestRuns)" />
                  {{ runStatusLabel(editForm, launcherStore.runningAppIds, launcherStore.latestRuns) || itemTypeLabel(editForm.type) }}
                </span>
                <span v-if="runState.pid != null" class="font-mono text-[11px] text-muted-foreground">PID {{ runState.pid }}</span>
                <Button v-if="editForm.type === 'web' && isRunning" type="button" variant="secondary" class="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground" @click="launcherStore.showAppWindow(editForm.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
                  窗口
                </Button>
                <Button v-if="hasLogSource" type="button" variant="secondary" class="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground" @click="sessionStore.openExistingLogDialog(editForm)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                  日志
                </Button>
              </div>
            </div>

            <div
              v-if="!appsStore.isNew"
              class="flex shrink-0 flex-wrap items-start justify-end gap-1.5 pt-0.5"
            >
              <LaunchActionGroup
                v-if="!isRunning"
                :label="primaryActionLabel(editForm)"
                :pending-launch="pendingLaunch"
                size="large"
                @cancel-delayed-launch="launcherStore.cancelDelayedLaunch(editForm.id)"
                @launch="emitLaunch"
              />
              <Button v-if="isRunning" type="button" variant="destructive" class="h-9 gap-2 px-4 text-sm" :disabled="isRestarting" @click="launcherStore.stopApp(editForm.id)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
                停止
              </Button>
              <Button v-if="isRestartable" type="button" variant="secondary" class="h-9 gap-2 px-4 text-sm text-muted-foreground hover:text-foreground" :disabled="isRestarting" @click="launcherStore.restartApp(editForm)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                {{ isRestarting ? '重启中' : '重启' }}
              </Button>
            </div>
          </div>
        </div>

        <div v-if="showLogPreview" class="relative mx-5 mt-4 rounded-md bg-[#1e1e2e] px-3 py-2 font-mono text-[11px] leading-[18px]">
          <button
            type="button"
            class="absolute right-2 top-1.5 cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-300"
            @click="sessionStore.openExistingLogDialog(editForm)"
          >
            查看全部
          </button>
          <div v-for="(line, i) in previewLines" :key="i" class="truncate text-zinc-400" :title="line">
            {{ line }}
          </div>
        </div>

        <div class="px-5 py-5">
          <AppCapabilityStack
            v-model="editForm"
            @set-type="appsStore.setAppType"
            @set-schedule-enabled="appsStore.setScheduleEnabled"
            @set-schedule-cron="appsStore.setScheduleCron"
            @set-missed-policy="appsStore.setMissedPolicy"
            @set-startup="appsStore.setStartup"
            @set-restart="appsStore.setRestart"
            @set-retry="appsStore.setRetry"
            @choose-working-directory="sessionStore.chooseWorkingDirectory"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 bg-muted/40 px-5 py-3 shadow-[inset_0_1px_0_0_var(--border)]">
          <Button size="sm" @click="appsStore.saveApp">{{ appsStore.isNew ? '添加' : '保存' }}</Button>
          <Button
            v-if="!appsStore.isNew"
            variant="secondary"
            size="sm"
            @click="sessionStore.duplicateSelectedApp"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V7a2 2 0 0 1 2-2h8" />
            </svg>
            复制
          </Button>
          <div class="flex-1" />
          <Button v-if="!appsStore.isNew" variant="destructive" size="sm" @click="appsStore.deleteApp">删除</Button>
        </div>
      </div>
    </div>
  </div>
</template>
