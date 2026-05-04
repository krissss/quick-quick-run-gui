<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { AppItem, StartupConfig } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const emit = defineEmits<{
  setStartup: [startup: StartupConfig]
}>()

const delaySeconds = computed({
  get: () => app.value.startup.delaySeconds,
  set: value => emit('setStartup', {
    ...app.value.startup,
    delaySeconds: Number(value) || 0,
  }),
})

function setEnabled(enabled: boolean) {
  emit('setStartup', {
    ...app.value.startup,
    enabled,
  })
}
</script>

<template>
  <div class="space-y-3 rounded-md bg-secondary/60 p-3" style="box-shadow: var(--shadow-border)">
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="text-sm font-medium">启动策略</div>
        <div class="mt-0.5 text-xs text-muted-foreground">主应用启动后自动运行</div>
      </div>
      <Switch aria-label="启动策略" :model-value="app.startup.enabled" @update:model-value="setEnabled" />
    </div>
    <div v-if="app.startup.enabled" class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center">
      <label class="text-xs font-medium text-muted-foreground">延迟启动</label>
      <Input v-model.number="delaySeconds" type="number" min="0" />
    </div>
  </div>
</template>
