<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  align?: 'inline-start' | 'inline-end'
  class?: ClassValue
}>(), {
  align: 'inline-start',
})

const classes = computed(() =>
  cn(
    'flex shrink-0 items-center justify-center text-muted-foreground',
    props.align === 'inline-start' ? 'pl-2' : 'pr-1',
    props.class,
  ),
)
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
