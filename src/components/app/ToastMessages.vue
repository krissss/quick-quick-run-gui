<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { useMessageStore } from '@/stores/message'

const messageStore = useMessageStore()
</script>

<template>
  <div class="pointer-events-none fixed left-4 top-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="item in messageStore.messages"
        :key="item.id"
        class="pointer-events-auto flex items-start gap-2.5 rounded-lg bg-background/98 px-3 py-2.5 text-card-foreground"
        style="box-shadow: var(--shadow-card), inset 0 0 0 1px rgba(0, 0, 0, 0.06)"
        :role="item.type === 'error' ? 'alert' : 'status'"
      >
        <div
          class="mt-0.5 h-5 w-1 shrink-0 rounded-full"
          :class="item.type === 'error' ? 'bg-destructive' : item.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'"
        />
        <div
          class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
          :class="item.type === 'error' ? 'bg-destructive/10 text-destructive' : item.type === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'"
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="h-6 w-6 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="关闭通知"
          aria-label="关闭通知"
          @click="messageStore.dismissMessage(item.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    filter 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
  filter: blur(2px);
}

.toast-move {
  transition: transform 180ms ease;
}
</style>
