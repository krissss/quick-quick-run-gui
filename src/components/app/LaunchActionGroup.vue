<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Clock, Play, Square } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DELAY_PRESETS, formatDelayLabel, normalizeDelaySeconds } from '@/lib/delay'

const props = withDefaults(defineProps<{
  label: string
  defaultDelaySeconds?: number | null
  disabled?: boolean
  size?: 'compact' | 'large' | 'row'
  pendingLaunch?: {
    delaySeconds: number
    runAt: number
  } | null
}>(), {
  defaultDelaySeconds: null,
  disabled: false,
  size: 'compact',
  pendingLaunch: null,
})

const emit = defineEmits<{
  launch: [delaySeconds?: number]
  cancelDelayedLaunch: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const open = ref(false)
const customDelay = ref(60)
const menuStyle = ref<Record<string, string>>({})
let listenersAttached = false

const defaultDelay = computed(() => normalizeDelaySeconds(props.defaultDelaySeconds))
const primaryLabel = computed(() =>
  defaultDelay.value ? `${formatDelayLabel(defaultDelay.value)}后运行` : props.label,
)
const customDelaySeconds = computed(() => normalizeDelaySeconds(customDelay.value))
const hasPendingLaunch = computed(() => !!props.pendingLaunch)
const primaryButtonClass = computed(() =>
  props.size === 'row'
    ? 'h-5 w-5 rounded-r-none px-0 text-muted-foreground hover:bg-accent hover:text-foreground shadow-none'
    : props.size === 'large'
    ? 'h-9 rounded-r-none px-4 text-sm shadow-none'
    : 'rounded-r-none shadow-none',
)
const menuButtonClass = computed(() =>
  props.size === 'row'
    ? 'h-5 w-5 rounded-l-none px-0 text-muted-foreground hover:bg-accent hover:text-foreground shadow-none'
    : props.size === 'large'
    ? 'h-9 w-9 rounded-l-none px-0 shadow-[inset_1px_0_0_0_rgba(255,255,255,0.24)]'
    : 'w-7 rounded-l-none px-0 shadow-[inset_1px_0_0_0_rgba(255,255,255,0.24)]',
)
const primaryIconSize = computed(() => props.size === 'large' ? 14 : 14)
const menuIconSize = computed(() => props.size === 'large' ? 14 : 12)
const iconStrokeWidth = computed(() => props.size === 'large' ? 2.25 : 2.5)
const buttonVariant = computed(() => props.size === 'row' ? 'ghost' : 'default')
const delayMenuLabel = computed(() =>
  props.size === 'row' ? `延迟${props.label}` : '延迟运行',
)
const popoverClass = computed(() =>
  props.size === 'row'
    ? 'z-50 w-56 rounded-lg bg-popover p-2 text-left'
    : 'z-50 w-56 rounded-lg bg-popover p-2',
)

function updateMenuPosition() {
  const root = rootRef.value
  if (!open.value || !root) return

  const rect = root.getBoundingClientRect()
  const menuWidth = menuRef.value?.offsetWidth || 224
  const menuHeight = menuRef.value?.offsetHeight || 0
  const viewportPadding = 8
  const gap = props.size === 'row' ? 4 : 8
  const left = Math.min(
    window.innerWidth - viewportPadding - menuWidth,
    Math.max(viewportPadding, rect.right - menuWidth),
  )
  const belowTop = rect.bottom + gap
  const aboveTop = rect.top - gap - menuHeight
  const top = belowTop + menuHeight > window.innerHeight - viewportPadding && aboveTop >= viewportPadding
    ? aboveTop
    : Math.max(viewportPadding, Math.min(belowTop, window.innerHeight - viewportPadding - menuHeight))

  menuStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: '14rem',
    maxHeight: 'calc(100vh - 16px)',
    overflowY: 'auto',
    boxShadow: 'var(--shadow-card)',
  }
}

async function toggleMenu() {
  if (props.disabled) return
  if (open.value) {
    closeMenu()
    return
  }
  open.value = true
  await nextTick()
  updateMenuPosition()
  attachGlobalListeners()
}

function closeMenu() {
  open.value = false
  menuStyle.value = {}
  detachGlobalListeners()
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target
  if (target instanceof Node && rootRef.value?.contains(target)) return
  if (target instanceof Node && menuRef.value?.contains(target)) return
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
  window.addEventListener('resize', updateMenuPosition)
  window.addEventListener('scroll', updateMenuPosition, true)
}

function detachGlobalListeners() {
  if (!listenersAttached) return
  listenersAttached = false
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeyDown)
  window.removeEventListener('resize', updateMenuPosition)
  window.removeEventListener('scroll', updateMenuPosition, true)
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
        :variant="buttonVariant"
        size="sm"
        :class="primaryButtonClass"
        :disabled="disabled"
        :aria-label="size === 'row' ? label : undefined"
        :title="size === 'row' ? label : undefined"
        @click="launch(defaultDelay)"
      >
        <Play :size="primaryIconSize" :stroke-width="iconStrokeWidth" aria-hidden="true" />
        <span v-if="size !== 'row'">{{ primaryLabel }}</span>
      </Button>
      <Button
        v-if="size === 'large' && hasPendingLaunch"
        type="button"
        variant="destructive"
        size="sm"
        class="h-9 gap-2 rounded-none px-4 text-sm"
        @click="$emit('cancelDelayedLaunch')"
      >
        <Square :size="14" :stroke-width="2.25" aria-hidden="true" />
        停止启动
      </Button>
      <Button
        type="button"
        :variant="buttonVariant"
        size="sm"
        :class="menuButtonClass"
        :disabled="disabled"
        :aria-expanded="open"
        :aria-label="delayMenuLabel"
        title="延迟运行"
        @click="toggleMenu"
      >
        <Clock :size="menuIconSize" :stroke-width="iconStrokeWidth" aria-hidden="true" />
      </Button>
    </div>

    <Teleport to="body">
      <div
        v-if="open"
        ref="menuRef"
        data-testid="launch-delay-menu"
        :class="popoverClass"
        :style="menuStyle"
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
    </Teleport>
  </div>
</template>
