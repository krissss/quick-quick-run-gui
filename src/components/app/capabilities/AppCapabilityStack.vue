<script setup lang="ts">
import { computed } from 'vue'
import { capabilitiesForType } from './capabilityRegistry'
import type { AppItem, AppType, MissedPolicy, RestartConfig, RetryConfig, StartupConfig } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const emit = defineEmits<{
  setType: [type: AppType]
  setScheduleEnabled: [enabled: boolean]
  setMissedPolicy: [missedPolicy: MissedPolicy]
  setScheduleCron: [cron: string]
  setStartup: [startup: StartupConfig]
  setRestart: [restart: RestartConfig]
  setRetry: [retry: RetryConfig]
  chooseWorkingDirectory: []
}>()

const capabilities = computed(() => capabilitiesForType(app.value.type, app.value))
</script>

<template>
  <div class="space-y-4" data-testid="app-capability-stack">
    <component
      :is="capability.component"
      v-for="capability in capabilities"
      :key="capability.id"
      v-model="app"
      :data-capability-id="capability.id"
      @set-type="emit('setType', $event)"
      @set-schedule-enabled="emit('setScheduleEnabled', $event)"
      @set-schedule-cron="emit('setScheduleCron', $event)"
      @set-missed-policy="emit('setMissedPolicy', $event)"
      @set-startup="emit('setStartup', $event)"
      @set-restart="emit('setRestart', $event)"
      @set-retry="emit('setRetry', $event)"
      @choose-working-directory="emit('chooseWorkingDirectory')"
    />
  </div>
</template>
