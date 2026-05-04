<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import type { AppItem } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const namePlaceholder = computed(() => {
  const command = app.value.command.trim()
  if (command) return command
  const url = app.value.url.trim()
  if (app.value.type === 'web' && url) return url
  return app.value.type === 'web' ? '默认使用启动命令或 URL' : '默认使用执行命令'
})
</script>

<template>
  <div class="space-y-1.5">
    <label class="text-xs font-medium text-muted-foreground">
      名称
      <span class="font-normal opacity-40">(可选)</span>
    </label>
    <Input v-model="app.name" :placeholder="namePlaceholder" />
  </div>
</template>
