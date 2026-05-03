<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  appId: string
  appName: string
  lines: string[]
  launchFailed: boolean
  launchFailedReason: string
  windowOpened: boolean
  runningAppIds: Set<string>
}>()

defineEmits<{
  close: []
  relaunch: [appId: string]
}>()

const logContainer = ref<HTMLElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

watch(() => props.lines.length, scrollToBottom)
watch(() => props.open, (open) => {
  if (open) scrollToBottom()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      @click.self="$emit('close')"
    >
      <div class="bg-card rounded-lg p-6 w-full max-w-2xl max-h-[80vh] flex flex-col" style="box-shadow: var(--shadow-card)">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-semibold tracking-[-0.32px]">{{ appName }} — 日志</h2>
          <div v-if="!launchFailed && !windowOpened && runningAppIds.has(appId)" class="flex items-center gap-1.5">
            <span class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span class="text-xs text-muted-foreground">启动中</span>
          </div>
          <span v-if="launchFailed" class="text-xs text-destructive font-medium">
            {{ launchFailedReason === 'process_exited' ? '进程已退出' : '启动超时' }}
          </span>
        </div>
        <div
          ref="logContainer"
          class="flex-1 overflow-y-auto bg-background rounded-md p-4 font-mono text-xs min-h-0"
          style="box-shadow: inset 0 0 0 1px var(--border)"
        >
          <div v-for="(line, i) in lines" :key="i" class="whitespace-pre-wrap break-all text-foreground/80 hover:text-foreground">{{ line }}</div>
          <div v-if="lines.length === 0" class="text-muted-foreground text-center py-10">暂无日志</div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <Button v-if="launchFailed" variant="destructive" size="sm" @click="$emit('relaunch', appId)">重新启动</Button>
          <Button variant="secondary" size="sm" @click="$emit('close')">关闭</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
