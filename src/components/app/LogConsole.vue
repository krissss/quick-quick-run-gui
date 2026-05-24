<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  lines: string[]
  size?: 'preview' | 'dialog'
  emptyLabel?: string
}>(), {
  size: 'preview',
  emptyLabel: '暂无日志',
})

const rootRef = ref<HTMLElement | null>(null)

const consoleClass = computed(() => [
  'block w-full rounded-md bg-[#1e1e2e] text-left font-mono',
  props.size === 'dialog'
    ? 'min-h-0 flex-1 overflow-auto px-3 py-3 text-xs leading-5'
    : 'overflow-x-auto px-2 py-1.5 text-[10px] leading-4',
])

function scrollToBottom() {
  if (!rootRef.value) return
  rootRef.value.scrollTop = rootRef.value.scrollHeight
}

defineExpose({
  scrollToBottom,
})
</script>

<template>
  <div ref="rootRef" :class="consoleClass">
    <div class="min-w-full w-max">
      <div
        v-for="(line, i) in lines"
        :key="i"
        class="w-max min-w-full whitespace-pre text-zinc-400 hover:text-zinc-200"
        :title="line"
      >
        {{ line }}
      </div>
      <div v-if="lines.length === 0" class="min-w-full py-10 text-center text-zinc-500">
        {{ emptyLabel }}
      </div>
    </div>
  </div>
</template>
