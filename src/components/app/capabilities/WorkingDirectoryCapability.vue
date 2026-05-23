<script setup lang="ts">
import { FolderOpen } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { ClearableInput } from '@/components/ui/clearable-input'
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
      <ClearableInput
        v-model="app.workingDirectory"
        class="min-w-0 flex-1 rounded-r-none shadow-none focus-within:shadow-none"
        input-class="focus-visible:shadow-none"
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
        <FolderOpen :size="13" :stroke-width="2.25" aria-hidden="true" />
      </Button>
    </div>
  </div>
</template>
