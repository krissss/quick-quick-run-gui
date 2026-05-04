<script setup lang="ts">
import { Input } from '@/components/ui/input'
import type { AppItem } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })
</script>

<template>
  <div class="grid grid-cols-2 gap-4">
    <div class="flex-1 space-y-1.5">
      <label class="text-xs font-medium text-muted-foreground">窗口宽度</label>
      <Input v-model.number="app.width" type="number" />
    </div>
    <div class="flex-1 space-y-1.5">
      <label class="text-xs font-medium text-muted-foreground">窗口高度</label>
      <Input v-model.number="app.height" type="number" />
    </div>
  </div>
</template>
