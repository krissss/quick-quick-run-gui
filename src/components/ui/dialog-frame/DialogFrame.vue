<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  closeLabel?: string
  closeDisabled?: boolean
  closeOnOverlay?: boolean
  panelClass?: ClassValue
  contentClass?: ClassValue
  footerClass?: ClassValue
}>(), {
  closeLabel: '关闭',
  closeDisabled: false,
  closeOnOverlay: true,
})

const emit = defineEmits<{
  close: []
}>()

const panelClasses = computed(() =>
  cn(
    'flex w-full max-h-[88vh] flex-col overflow-hidden rounded-lg bg-card',
    props.panelClass,
  ),
)

const contentClasses = computed(() =>
  cn(
    'min-h-0 flex-1 overflow-y-auto px-6 py-5',
    props.contentClass,
  ),
)

const footerClasses = computed(() =>
  cn(
    'flex items-center justify-end gap-2 bg-muted/40 px-6 py-3 shadow-[inset_0_1px_0_0_var(--border)]',
    props.footerClass,
  ),
)

function requestClose() {
  if (props.closeDisabled) return
  emit('close')
}

function handleOverlayClick() {
  if (!props.closeOnOverlay) return
  requestClose()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="handleOverlayClick"
    >
      <section
        :class="panelClasses"
        style="box-shadow: var(--shadow-card)"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="flex items-start justify-between gap-4 px-6 py-4 shadow-[inset_0_-1px_0_0_var(--border)]">
          <div class="min-w-0">
            <slot name="subtitle" />
            <h2 class="truncate text-base font-semibold tracking-[-0.32px]">{{ title }}</h2>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <slot name="header-actions" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
              :disabled="closeDisabled"
              :aria-label="closeLabel"
              :title="closeLabel"
              @click="requestClose"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </Button>
          </div>
        </header>

        <div :class="contentClasses">
          <slot />
        </div>

        <footer v-if="$slots.footer" :class="footerClasses">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>
