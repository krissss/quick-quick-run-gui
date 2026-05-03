<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: string
  type?: string
  placeholder?: string
  disabled?: boolean
}>()

const value = defineModel<string | number>()

const classes = computed(() =>
  cn(
    'flex h-9 w-full rounded-md bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50 shadow-[var(--shadow-border)] focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]',
    props.class,
  ),
)
</script>

<template>
  <input
    :class="classes"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
    v-model="value"
  />
</template>
