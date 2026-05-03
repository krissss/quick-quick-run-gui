<script setup lang="ts">
import type { MessageItem } from '@/composables/useMessage'

defineProps<{
  messages: MessageItem[]
}>()

defineEmits<{
  dismiss: [id: number]
}>()
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
    <div
      v-for="item in messages"
      :key="item.id"
      class="pointer-events-auto flex items-start gap-2.5 rounded-lg bg-card px-3 py-2.5 text-card-foreground"
      style="box-shadow: var(--shadow-card)"
      :role="item.type === 'error' ? 'alert' : 'status'"
    >
      <div
        class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        :class="item.type === 'error' ? 'bg-destructive/10 text-destructive' : item.type === 'success' ? 'bg-secondary text-foreground' : 'bg-secondary text-muted-foreground'"
      >
        <svg
          v-if="item.type === 'success'"
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <svg
          v-else-if="item.type === 'error'"
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </div>
      <p class="min-w-0 flex-1 break-words text-sm leading-5 text-foreground">
        {{ item.text }}
      </p>
      <button
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
        type="button"
        title="关闭通知"
        aria-label="关闭通知"
        @click="$emit('dismiss', item.id)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
