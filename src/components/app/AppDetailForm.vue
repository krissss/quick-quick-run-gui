<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import CommandTemplateTooltip from '@/components/command/CommandTemplateTooltip.vue'
import CronSchedulePicker from '@/components/schedule/CronSchedulePicker.vue'
import {
  iconGradient,
  itemTypeLabel,
  primaryActionLabel,
  runStatusClass,
  runStatusLabel,
  schedulePolicyLabel,
  statusDotClass,
} from '@/lib/appDisplay'
import type { AppItem, AppType, MissedPolicy } from '@/lib/store'
import type { RunRecord } from '@/composables/useLauncher'

const editForm = defineModel<AppItem>({ required: true })

const props = defineProps<{
  isNew: boolean
  runningAppIds: Set<string>
  runningPids: Map<string, number>
  latestRuns: Map<string, RunRecord>
}>()

const emit = defineEmits<{
  save: []
  duplicate: []
  launch: [app: AppItem]
  delete: []
  setType: [type: AppType]
  setScheduleEnabled: [enabled: boolean]
  setMissedPolicy: [missedPolicy: MissedPolicy]
  setScheduleCron: [cron: string]
  chooseWorkingDirectory: []
  showWindow: [appId: string]
  openLog: [app: AppItem]
  stop: [appId: string]
}>()

function namePlaceholder() {
  const command = editForm.value.command.trim()
  if (command) return command
  const url = editForm.value.url.trim()
  if (editForm.value.type === 'web' && url) return url
  return editForm.value.type === 'web' ? '默认使用启动命令或 URL' : '默认使用执行命令'
}

function updateType(value: string | string[]) {
  if (typeof value === 'string' && value) emit('setType', value as AppType)
}

function updateMissedPolicy(value: string | string[]) {
  if (typeof value === 'string' && value) emit('setMissedPolicy', value as MissedPolicy)
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-md mx-auto py-12 px-6 space-y-6">
      <div class="flex items-center gap-4">
        <div
          v-if="!props.isNew && editForm.name"
          class="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center text-lg font-semibold"
          :class="iconGradient(editForm.name)"
        >
          {{ editForm.name.charAt(0).toUpperCase() }}
        </div>
        <div v-else class="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center bg-secondary text-muted-foreground">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </div>
        <div class="min-w-0">
          <h2 class="text-base font-semibold tracking-[-0.32px]">
            {{ props.isNew ? '添加应用' : editForm.name || '未命名' }}
          </h2>
          <div v-if="!props.isNew" class="flex flex-wrap items-center gap-2 mt-1">
            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" :class="runStatusClass(editForm, props.runningAppIds, props.latestRuns)">
              <span class="w-1.5 h-1.5 rounded-full" :class="statusDotClass(editForm, props.runningAppIds, props.latestRuns)" />
              {{ runStatusLabel(editForm, props.runningAppIds, props.latestRuns) || itemTypeLabel(editForm.type) }}
            </span>
            <span v-if="props.runningPids.has(editForm.id)" class="text-[11px] text-muted-foreground font-mono">PID {{ props.runningPids.get(editForm.id) }}</span>
            <button v-if="editForm.type === 'web' && props.runningAppIds.has(editForm.id)" class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-foreground transition-colors cursor-pointer" @click="$emit('showWindow', editForm.id)">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
              窗口
            </button>
            <button v-if="editForm.command" class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-foreground transition-colors cursor-pointer" @click="$emit('openLog', editForm)">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
              日志
            </button>
            <button v-if="props.runningAppIds.has(editForm.id)" class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-destructive transition-colors cursor-pointer" @click="$emit('stop', editForm.id)">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
              停止
            </button>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">类型</label>
          <ToggleGroup
            class="grid w-full grid-cols-3 gap-1"
            :model-value="editForm.type"
            type="single"
            @update:model-value="updateType"
          >
            <ToggleGroupItem value="web">
              网页
            </ToggleGroupItem>
            <ToggleGroupItem value="service">
              服务
            </ToggleGroupItem>
            <ToggleGroupItem value="task">
              任务
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div v-if="editForm.type === 'web'" class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">目标 URL</label>
          <Input v-model="editForm.url" placeholder="http://localhost:3000" />
        </div>
        <div class="space-y-1.5">
          <label class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span>{{ editForm.type === 'task' ? '执行命令' : '启动命令' }}</span>
            <span v-if="editForm.type === 'web'" class="font-normal opacity-40">(可选)</span>
            <CommandTemplateTooltip />
          </label>
          <Input v-model="editForm.command" :placeholder="editForm.type === 'task' ? 'pnpm report' : 'npm run dev'" />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">
            工作目录
            <span class="font-normal opacity-40">(可选)</span>
          </label>
          <div class="flex rounded-md shadow-[var(--shadow-border)] focus-within:shadow-[inset_0_0_0_1px_var(--ring)]">
            <Input v-model="editForm.workingDirectory" class="min-w-0 flex-1 rounded-r-none shadow-none focus-visible:shadow-none" placeholder="~/repo" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="shrink-0 rounded-l-none shadow-[inset_1px_0_0_0_var(--border)]"
              title="选择工作目录"
              aria-label="选择工作目录"
              @click="$emit('chooseWorkingDirectory')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              </svg>
            </Button>
          </div>
        </div>
        <div v-if="editForm.type === 'task'" class="space-y-3 rounded-lg bg-card p-3" style="box-shadow: var(--shadow-border)">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-medium">定时执行</div>
              <div class="text-xs text-muted-foreground mt-0.5">运行期间按 cron 触发</div>
            </div>
            <Switch :model-value="editForm.schedule.enabled" @update:model-value="$emit('setScheduleEnabled', $event)" />
          </div>
          <div v-if="editForm.schedule.enabled" class="space-y-3">
            <CronSchedulePicker
              :model-value="editForm.schedule.cron"
              @update:model-value="$emit('setScheduleCron', $event)"
            />
            <div class="space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">错过执行</label>
              <ToggleGroup
                class="grid w-full grid-cols-2 gap-1"
                :model-value="editForm.schedule.missedPolicy"
                type="single"
                aria-label="错过执行方式"
                @update:model-value="updateMissedPolicy"
              >
                <ToggleGroupItem value="skip">
                  {{ schedulePolicyLabel('skip') }}
                </ToggleGroupItem>
                <ToggleGroupItem value="run-once">
                  {{ schedulePolicyLabel('run-once') }}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">
            名称
            <span class="font-normal opacity-40">(可选)</span>
          </label>
          <Input v-model="editForm.name" :placeholder="namePlaceholder()" />
        </div>
        <div v-if="editForm.type === 'web'" class="flex gap-4">
          <div class="flex-1 space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">宽度</label>
            <Input v-model.number="editForm.width" type="number" />
          </div>
          <div class="flex-1 space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">高度</label>
            <Input v-model.number="editForm.height" type="number" />
          </div>
        </div>
      </div>

      <div class="flex gap-2 pt-2">
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
        <Button
          v-if="!props.isNew"
          size="sm"
          @click="$emit('launch', editForm)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
          {{ primaryActionLabel(editForm) }}
        </Button>
        <div class="flex-1" />
        <Button v-if="!props.isNew" variant="destructive" size="sm" @click="$emit('delete')">删除</Button>
      </div>
    </div>
  </div>
</template>
