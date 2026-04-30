<script setup lang="ts">
import { computed } from 'vue'
import { ToggleGroupItem as RadixToggleGroupItem, type ToggleGroupItemProps } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<ToggleGroupItemProps & {
  class?: string
}>()

const delegatedProps = computed(() => {
  const { class: _class, ...delegated } = props
  return delegated
})

const classes = computed(() =>
  cn(
    'inline-flex h-8 min-w-0 items-center justify-center rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors',
    'hover:text-foreground focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]',
    'disabled:pointer-events-none disabled:opacity-50',
    'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-[var(--shadow-border)]',
    props.class,
  ),
)
</script>

<template>
  <RadixToggleGroupItem v-bind="delegatedProps" :class="classes">
    <slot />
  </RadixToggleGroupItem>
</template>
