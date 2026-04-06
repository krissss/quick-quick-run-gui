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
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
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
