<script setup lang="ts">
import { computed } from 'vue'
import { Clock, Globe, List, Plus } from '@lucide/vue'
import type { AppItem } from '@/lib/store'

const props = withDefaults(defineProps<{
  app: AppItem
  faviconUrl?: string
  isNew?: boolean
  size?: 'sm' | 'lg'
}>(), {
  faviconUrl: '',
  isNew: false,
  size: 'sm',
})

const emit = defineEmits<{
  'favicon-error': []
}>()

const containerClass = computed(() =>
  props.size === 'lg'
    ? 'h-12 w-12 rounded-lg'
    : 'h-8 w-8 rounded-md',
)

const imageClass = computed(() =>
  props.size === 'lg'
    ? 'h-8 w-8 rounded-md'
    : 'h-5 w-5 rounded-[3px]',
)

const fallbackIcon = computed(() => {
  if (props.isNew) return Plus
  if (props.app.type === 'service') return List
  if (props.app.type === 'task') return Clock
  return Globe
})

const fallbackIconSize = computed(() => props.size === 'lg' ? 22 : 15)
const showFavicon = computed(() => !props.isNew && props.app.type === 'web' && !!props.faviconUrl)
</script>

<template>
  <div
    class="flex shrink-0 items-center justify-center bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]"
    :class="containerClass"
    data-testid="app-icon"
  >
    <img
      v-if="showFavicon"
      :src="faviconUrl"
      :alt="`${app.name} favicon`"
      class="object-contain"
      :class="imageClass"
      loading="lazy"
      decoding="async"
      @error="emit('favicon-error')"
    >
    <component
      :is="fallbackIcon"
      v-else
      :size="fallbackIconSize"
      :stroke-width="2.25"
      aria-hidden="true"
    />
  </div>
</template>
