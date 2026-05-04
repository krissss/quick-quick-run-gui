<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { AppItem, RestartConfig, RestartMode } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const emit = defineEmits<{
  setRestart: [restart: RestartConfig]
}>()

const maxAttempts = computed({
  get: () => app.value.restart.maxAttempts,
  set: value => emit('setRestart', {
    ...app.value.restart,
    maxAttempts: Number(value) || 1,
  }),
})

const delaySeconds = computed({
  get: () => app.value.restart.delaySeconds,
  set: value => emit('setRestart', {
    ...app.value.restart,
    delaySeconds: Number(value) || 0,
  }),
})

function setEnabled(enabled: boolean) {
  emit('setRestart', {
    ...app.value.restart,
    enabled,
  })
}

function updateMode(value: string | string[]) {
  if (typeof value === 'string' && value) {
    emit('setRestart', {
      ...app.value.restart,
      mode: value as RestartMode,
    })
  }
}
</script>

<template>
  <div class="space-y-3 rounded-md bg-secondary/60 p-3" style="box-shadow: var(--shadow-border)">
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="text-sm font-medium">重启策略</div>
        <div class="mt-0.5 text-xs text-muted-foreground">进程退出后自动重新启动</div>
      </div>
      <Switch aria-label="重启策略" :model-value="app.restart.enabled" @update:model-value="setEnabled" />
    </div>
    <div v-if="app.restart.enabled" class="space-y-3">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">触发方式</label>
        <ToggleGroup
          class="grid w-full grid-cols-2 gap-1"
          :model-value="app.restart.mode"
          type="single"
          @update:model-value="updateMode"
        >
          <ToggleGroupItem value="on-failure">失败时</ToggleGroupItem>
          <ToggleGroupItem value="always">总是</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">最多次数</label>
          <Input v-model.number="maxAttempts" type="number" min="1" />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">间隔秒数</label>
          <Input v-model.number="delaySeconds" type="number" min="0" />
        </div>
      </div>
    </div>
  </div>
</template>
