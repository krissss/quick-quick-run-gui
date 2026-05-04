<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import CommandTemplateTooltip from '@/components/command/CommandTemplateTooltip.vue'
import type { AppItem } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const commandLabel = computed(() => app.value.type === 'task' ? '执行命令' : '启动命令')
const commandPlaceholder = computed(() => app.value.type === 'task' ? 'pnpm report' : 'npm run dev')
</script>

<template>
  <div class="space-y-1.5">
    <label class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{{ commandLabel }}</span>
      <span v-if="app.type === 'web'" class="font-normal opacity-40">(可选)</span>
      <CommandTemplateTooltip />
    </label>
    <Input v-model="app.command" :placeholder="commandPlaceholder" />
  </div>
</template>
