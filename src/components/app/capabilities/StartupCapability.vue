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
  <div class="rounded-md bg-secondary/60 p-3" style="box-shadow: var(--shadow-border)">
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium">启动策略</div>
        <div class="mt-0.5 truncate text-xs text-muted-foreground">主应用启动后自动运行</div>
      </div>
      <label
        class="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground"
        :class="app.startup.enabled ? 'opacity-100' : 'opacity-45'"
      >
        <span>延迟</span>
        <Input
          v-model.number="delaySeconds"
          type="number"
          min="0"
          class="h-7 w-20 px-2 text-xs"
          :disabled="!app.startup.enabled"
        />
        <span>秒</span>
      </label>
      <Switch aria-label="启动策略" :model-value="app.startup.enabled" @update:model-value="setEnabled" />
    </div>
  </div>
</template>
