<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { AppItem, RetryConfig } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const emit = defineEmits<{
  setRetry: [retry: RetryConfig]
}>()

const maxAttempts = computed({
  get: () => app.value.retry.maxAttempts,
  set: value => emit('setRetry', {
    ...app.value.retry,
    maxAttempts: Number(value) || 1,
  }),
})

const delaySeconds = computed({
  get: () => app.value.retry.delaySeconds,
  set: value => emit('setRetry', {
    ...app.value.retry,
    delaySeconds: Number(value) || 0,
  }),
})

function setEnabled(enabled: boolean) {
  emit('setRetry', {
    ...app.value.retry,
    enabled,
  })
}
</script>

<template>
  <div class="space-y-3 rounded-md bg-secondary/60 p-3" style="box-shadow: var(--shadow-border)">
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="text-sm font-medium">失败重试</div>
        <div class="mt-0.5 text-xs text-muted-foreground">任务失败后自动再次运行</div>
      </div>
      <Switch aria-label="失败重试" :model-value="app.retry.enabled" @update:model-value="setEnabled" />
    </div>
    <div v-if="app.retry.enabled" class="grid grid-cols-2 gap-4">
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
</template>
