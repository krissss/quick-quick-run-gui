<script setup lang="ts">
import { ClearableInput } from '@/components/ui/clearable-input'
import type { AppItem } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })
</script>

<template>
  <div class="space-y-1.5">
    <label class="text-xs font-medium text-muted-foreground">目标 URL</label>
    <ClearableInput v-model="app.url" placeholder="http://localhost:3000" />
  </div>
</template>
