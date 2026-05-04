<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DELAY_PRESETS, formatDelayLabel, normalizeDelaySeconds } from '@/lib/delay'

const props = withDefaults(defineProps<{
  label: string
  defaultDelaySeconds?: number | null
  disabled?: boolean
}>(), {
  defaultDelaySeconds: null,
  disabled: false,
})

const emit = defineEmits<{
  launch: [delaySeconds?: number]
}>()

const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)
const customDelay = ref(60)
let listenersAttached = false

const defaultDelay = computed(() => normalizeDelaySeconds(props.defaultDelaySeconds))
const primaryLabel = computed(() =>
  defaultDelay.value ? `${formatDelayLabel(defaultDelay.value)}后运行` : props.label,
)
const customDelaySeconds = computed(() => normalizeDelaySeconds(customDelay.value))

function toggleMenu() {
  if (props.disabled) return
  if (open.value) {
    closeMenu()
    return
  }
  open.value = true
  attachGlobalListeners()
}

function closeMenu() {
  open.value = false
  detachGlobalListeners()
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target
  if (target instanceof Node && rootRef.value?.contains(target)) return
  closeMenu()
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

function attachGlobalListeners() {
  if (listenersAttached) return
  listenersAttached = true
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeyDown)
}

function detachGlobalListeners() {
  if (!listenersAttached) return
  listenersAttached = false
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeyDown)
}

function launch(delaySeconds?: number | null) {
  closeMenu()
  const normalized = normalizeDelaySeconds(delaySeconds)
  if (normalized) {
    emit('launch', normalized)
    return
  }
  emit('launch')
}

onBeforeUnmount(detachGlobalListeners)
</script>

<template>
  <div ref="rootRef" class="relative inline-flex">
    <div class="inline-flex rounded-md">
      <Button
        type="button"
        size="sm"
        class="rounded-r-none shadow-none"
        :disabled="disabled"
        @click="launch(defaultDelay)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        {{ primaryLabel }}
      </Button>
      <Button
        type="button"
        variant="default"
        size="sm"
        class="w-7 rounded-l-none px-0 shadow-[inset_1px_0_0_0_rgba(255,255,255,0.24)]"
        :disabled="disabled"
        :aria-expanded="open"
        aria-label="延迟运行"
        title="延迟运行"
        @click="toggleMenu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </Button>
    </div>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-30 mb-2 w-56 rounded-lg bg-popover p-2"
      style="box-shadow: var(--shadow-card)"
    >
      <div class="px-2 pb-1 text-[11px] font-medium text-muted-foreground">延迟运行</div>
      <div class="grid grid-cols-2 gap-1">
        <Button
          v-for="delay in DELAY_PRESETS"
          :key="delay"
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 justify-start px-2 text-xs"
          @click="launch(delay)"
        >
          {{ formatDelayLabel(delay) }}
        </Button>
      </div>
      <div class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input
          v-model.number="customDelay"
          type="number"
          min="1"
          :max="86400"
          class="h-7 text-xs"
          aria-label="自定义延迟秒数"
        />
        <Button
          type="button"
          size="sm"
          class="h-7 px-2 text-xs"
          :disabled="!customDelaySeconds"
          @click="launch(customDelaySeconds)"
        >
          秒后
        </Button>
      </div>
    </div>
  </div>
</template>
