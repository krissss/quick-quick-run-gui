<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: ClassValue
}>()

const classes = computed(() =>
  cn(
    'relative flex h-9 w-full min-w-0 items-center overflow-hidden rounded-md bg-transparent text-sm shadow-[var(--shadow-border)] focus-within:shadow-[inset_0_0_0_1px_var(--ring)]',
    props.class,
  ),
)
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
