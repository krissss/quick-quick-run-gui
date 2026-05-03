<script setup lang="ts">
import { computed } from 'vue'
import { TooltipContent, TooltipPortal, type TooltipContentProps } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<TooltipContentProps & {
  class?: string
}>(), {
  sideOffset: 6,
})

const forwardedProps = computed(() => {
  const { class: _class, ...rest } = props
  return rest
})
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="forwardedProps"
      :class="cn(
        'z-50 max-w-xs rounded-md bg-popover px-3 py-2 text-xs leading-5 text-popover-foreground',
        'shadow-[var(--shadow-card)] outline-none',
        'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
        props.class,
      )"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
