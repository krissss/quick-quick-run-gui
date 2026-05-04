<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AppItem } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const emit = defineEmits<{
  chooseWorkingDirectory: []
}>()
</script>

<template>
  <div class="space-y-1.5">
    <label class="text-xs font-medium text-muted-foreground">
      工作目录
      <span class="font-normal opacity-40">(可选)</span>
    </label>
    <div class="flex rounded-md shadow-[var(--shadow-border)] focus-within:shadow-[inset_0_0_0_1px_var(--ring)]">
      <Input
        v-model="app.workingDirectory"
        class="min-w-0 flex-1 rounded-r-none shadow-none focus-visible:shadow-none"
        placeholder="~/repo"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="shrink-0 rounded-l-none shadow-[inset_1px_0_0_0_var(--border)]"
        title="选择工作目录"
        aria-label="选择工作目录"
        @click="emit('chooseWorkingDirectory')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
      </Button>
    </div>
  </div>
</template>
