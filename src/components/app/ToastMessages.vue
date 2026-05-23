<script setup lang="ts">
import { Check, CircleX, Info, X } from '@lucide/vue'
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
          <Check v-if="item.type === 'success'" :size="13" :stroke-width="2.5" aria-hidden="true" />
          <CircleX v-else-if="item.type === 'error'" :size="13" :stroke-width="2.5" aria-hidden="true" />
          <Info v-else :size="13" :stroke-width="2.5" aria-hidden="true" />
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
          <X :size="13" :stroke-width="2.25" aria-hidden="true" />
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
