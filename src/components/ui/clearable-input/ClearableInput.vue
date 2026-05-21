<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed, ref, useAttrs } from 'vue'
import { X } from '@lucide/vue'
import {
  InputGroup,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  class?: ClassValue
  inputClass?: ClassValue
  type?: string
  placeholder?: string
  disabled?: boolean
  clearLabel?: string
}>()

const value = defineModel<string | number>()
const attrs = useAttrs()
const inputRef = ref<{ focus: () => void } | null>(null)

const hasValue = computed(() => value.value !== undefined && value.value !== null && String(value.value).length > 0)
const clearButtonLabel = computed(() => props.clearLabel || '清空输入')

const inputClasses = computed(() =>
  cn(
    hasValue.value ? 'pr-9' : undefined,
    props.inputClass,
  ),
)

function clearValue() {
  value.value = ''
  inputRef.value?.focus()
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({
  focus,
})
</script>

<template>
  <InputGroup :class="cn('group', props.class)">
    <InputGroupInput
      ref="inputRef"
      v-bind="attrs"
      v-model="value"
      :class="inputClasses"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :disabled="disabled"
    />
    <div v-if="hasValue && !disabled" class="absolute inset-y-0 right-1 flex items-center">
      <InputGroupButton
        class="h-6 w-6 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
        :aria-label="clearButtonLabel"
        :title="clearButtonLabel"
        @mousedown.prevent.stop
        @click.prevent.stop="clearValue"
      >
        <X class="h-3.5 w-3.5" aria-hidden="true" />
      </InputGroupButton>
    </div>
  </InputGroup>
</template>
