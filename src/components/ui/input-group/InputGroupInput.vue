<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed, ref } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: ClassValue
  type?: string
  placeholder?: string
  disabled?: boolean
}>()

const value = defineModel<string | number>()
const inputRef = ref<HTMLInputElement | null>(null)

const classes = computed(() =>
  cn(
    'min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:shadow-none disabled:cursor-not-allowed disabled:opacity-50',
    props.class,
  ),
)

function focus() {
  inputRef.value?.focus()
}

defineExpose({
  focus,
})
</script>

<template>
  <input
    ref="inputRef"
    v-model="value"
    :class="classes"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
  />
</template>
