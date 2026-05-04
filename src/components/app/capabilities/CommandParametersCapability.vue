<script setup lang="ts">
import { computed } from 'vue'
import { parseCommandSignature, type AppItem } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const commandParams = computed(() => parseCommandSignature(app.value.command).params)
const profileCount = computed(() => app.value.profiles.length)
</script>

<template>
  <div class="rounded-md bg-secondary/60 p-3" style="box-shadow: var(--shadow-border)">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium">运行参数</div>
        <div class="mt-0.5 text-xs leading-5 text-muted-foreground">
          启动时选择参数，可临时运行、保存方案或更新已有方案。
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap justify-end gap-1">
        <span class="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-[var(--shadow-border)]">
          {{ commandParams.length }} 个参数
        </span>
        <span
          v-if="profileCount > 0"
          class="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-[var(--shadow-border)]"
        >
          {{ profileCount }} 个方案
        </span>
      </div>
    </div>
  </div>
</template>
