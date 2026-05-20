<script setup lang="ts">
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import CronSchedulePicker from '@/components/schedule/CronSchedulePicker.vue'
import { schedulePolicyLabel } from '@/lib/appDisplay'
import type { AppItem, MissedPolicy } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const emit = defineEmits<{
  setScheduleEnabled: [enabled: boolean]
  setScheduleCron: [cron: string]
  setMissedPolicy: [missedPolicy: MissedPolicy]
}>()

function updateMissedPolicy(value: string | string[]) {
  if (typeof value === 'string' && value) emit('setMissedPolicy', value as MissedPolicy)
}
</script>

<template>
  <div class="space-y-2.5 rounded-md bg-secondary/50 p-2.5" style="box-shadow: var(--shadow-border)">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium">定时执行</div>
        <div class="mt-0.5 text-xs text-muted-foreground">按 cron 周期触发</div>
      </div>
      <Switch
        aria-label="定时执行"
        :model-value="app.schedule.enabled"
        @update:model-value="emit('setScheduleEnabled', $event)"
      />
    </div>

    <div v-if="app.schedule.enabled" class="space-y-2.5">
      <CronSchedulePicker
        :model-value="app.schedule.cron"
        dense
        @update:model-value="emit('setScheduleCron', $event)"
      />

      <div class="flex items-center justify-between gap-3">
        <label class="text-xs font-medium text-muted-foreground">错过执行</label>
        <ToggleGroup
          class="grid min-w-[180px] grid-cols-2 gap-1"
          :model-value="app.schedule.missedPolicy"
          type="single"
          aria-label="错过执行方式"
          @update:model-value="updateMissedPolicy"
        >
          <ToggleGroupItem value="skip" class="h-7 px-2">
            {{ schedulePolicyLabel('skip') }}
          </ToggleGroupItem>
          <ToggleGroupItem value="run-once" class="h-7 px-2">
            {{ schedulePolicyLabel('run-once') }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  </div>
</template>
