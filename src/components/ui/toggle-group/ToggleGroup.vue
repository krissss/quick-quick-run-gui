<script setup lang="ts">
import { computed } from 'vue'
import { ToggleGroupRoot, type ToggleGroupRootProps } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<ToggleGroupRootProps & {
  class?: string
}>(), {
  type: 'single',
  orientation: 'horizontal',
  loop: true,
  rovingFocus: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]]
}>()

const delegatedProps = computed(() => {
  const { class: _class, ...delegated } = props
  return delegated
})

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center rounded-lg bg-secondary p-1 text-muted-foreground',
    props.class,
  ),
)
</script>

<template>
  <ToggleGroupRoot
    v-bind="delegatedProps"
    :class="classes"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <slot />
  </ToggleGroupRoot>
</template>
