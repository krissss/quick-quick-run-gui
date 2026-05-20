<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  class?: string
  type?: string
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
  clearButtonClass?: string
}>(), {
  clearable: true,
})

const value = defineModel<string | number>()
const attrs = useAttrs()
const inputRef = ref<HTMLInputElement | null>(null)

const isClearable = computed(() => props.clearable !== false)
const hasValue = computed(() => value.value !== undefined && value.value !== null && String(value.value).length > 0)
const showClearButton = computed(() => isClearable.value && hasValue.value && !props.disabled)

const classes = computed(() =>
  cn(
    'flex h-9 w-full rounded-md bg-transparent py-2 pl-3 pr-9 text-sm text-foreground placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50 shadow-[var(--shadow-border)] focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]',
    props.class,
  ),
)

const clearButtonClasses = computed(() =>
  cn(
    'absolute right-2 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/35 opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none group-hover:opacity-60 group-focus-within:opacity-100 disabled:pointer-events-none',
    props.clearButtonClass,
  ),
)

function clearValue() {
  value.value = ''
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({
  focus,
})
</script>

<template>
  <div class="group relative w-full">
    <input
      ref="inputRef"
      v-bind="attrs"
      v-model="value"
      :class="classes"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :disabled="disabled"
    />
    <button
      v-if="showClearButton"
      type="button"
      :class="clearButtonClasses"
      aria-label="清空输入"
      title="清空"
      :disabled="!hasValue || disabled"
      @mousedown.prevent
      @click="clearValue"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
</template>
