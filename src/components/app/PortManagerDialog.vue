<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DialogFrame } from '@/components/ui/dialog-frame'
import { Input } from '@/components/ui/input'

type PortProcessInfo = {
  pid: number
  command: string
  full_command: string
  parent_pid: number | null
  process_role: string
  user: string
  protocol: string
  address: string
  port: number
  raw: string
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  message: [text: string, type?: 'success' | 'error' | 'info']
}>()

const portInput = ref('')
const portInputRef = ref<{ $el: HTMLInputElement } | null>(null)
const results = ref<PortProcessInfo[]>([])
const searchedPort = ref<number | null>(null)
const isInspecting = ref(false)
const killingPid = ref<number | null>(null)
const pendingKill = ref<PortProcessInfo | null>(null)
const statusMessage = ref('')
const statusType = ref<'success' | 'error' | 'info'>('info')

const parsedPort = computed(() => {
  const value = Number(portInput.value)
  if (!Number.isInteger(value) || value < 1 || value > 65535) return null
  return value
})

const canInspect = computed(() => parsedPort.value !== null && !isInspecting.value)

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  portInputRef.value?.$el?.focus()
})

function setStatus(text: string, type: 'success' | 'error' | 'info' = 'info') {
  statusMessage.value = text
  statusType.value = type
  emit('message', text, type)
}

function processRoleClass(role: string) {
  if (role === '主进程') return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
  if (role === '子进程') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
  return 'bg-secondary text-muted-foreground'
}

function processTooltip(process: PortProcessInfo) {
  return [
    `PID: ${process.pid}`,
    `PPID: ${process.parent_pid ?? '-'}`,
    `关系: ${process.process_role || '独立进程'}`,
    `用户: ${process.user || '-'}`,
    `监听: ${process.address || '-'}`,
    `协议: ${process.protocol || 'TCP'}`,
    `端口: ${process.port}`,
    `进程: ${process.command || 'unknown'}`,
    `命令: ${process.full_command || process.raw || '-'}`,
  ].join('\n')
}

async function inspectPort(options: { keepStatus?: boolean } = {}) {
  if (!parsedPort.value) {
    setStatus('请输入 1 到 65535 之间的端口号', 'error')
    return
  }

  isInspecting.value = true
  searchedPort.value = parsedPort.value
  if (!options.keepStatus) statusMessage.value = ''
  try {
    results.value = await invoke<PortProcessInfo[]>('inspect_port', { port: parsedPort.value })
    if (results.value.length === 0 && !options.keepStatus) {
      setStatus(`端口 ${parsedPort.value} 当前没有监听进程`, 'info')
    }
  } catch (error) {
    results.value = []
    setStatus(String(error), 'error')
  } finally {
    isInspecting.value = false
  }
}

function requestKill(process: PortProcessInfo) {
  pendingKill.value = process
}

function cancelKill() {
  pendingKill.value = null
}

async function confirmKill() {
  if (!pendingKill.value) return

  const pid = pendingKill.value.pid
  const port = pendingKill.value.port
  killingPid.value = pid
  cancelKill()
  setStatus(`正在结束 PID ${pid}（端口 ${port}）...`, 'info')
  try {
    const result = await invoke<{ message: string }>('kill_port_pid', { port, pid })
    setStatus(result.message || `已结束 PID ${pid}`, 'success')
    await inspectPort({ keepStatus: true })
  } catch (error) {
    setStatus(String(error), 'error')
  } finally {
    killingPid.value = null
  }
}

function closeDialog() {
  if (isInspecting.value || killingPid.value !== null) return
  cancelKill()
  emit('close')
}
</script>

<template>
  <DialogFrame
    :open="open"
    title="端口排查"
    close-label="关闭端口排查"
    panel-class="max-w-3xl"
    :close-disabled="isInspecting || killingPid !== null"
    @close="closeDialog"
  >
    <div class="space-y-4">
      <form class="flex items-center gap-2" @submit.prevent="inspectPort()">
        <div class="relative flex-1">
          <Input
            ref="portInputRef"
            v-model="portInput"
            class="h-9 pr-20 font-mono text-sm tabular-nums"
            type="number"
            min="1"
            max="65535"
            placeholder="3000"
            aria-label="端口号"
          />
          <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium uppercase text-muted-foreground">
            TCP
          </span>
        </div>
        <Button
          type="submit"
          class="h-9"
          :disabled="!canInspect"
        >
          {{ isInspecting ? '查询中' : '查询' }}
        </Button>
      </form>

      <div
        v-if="statusMessage"
        class="rounded-md px-3 py-2 text-xs leading-5"
        :class="statusType === 'error'
          ? 'bg-destructive/10 text-destructive'
          : statusType === 'success'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-secondary text-muted-foreground'"
      >
        {{ statusMessage }}
      </div>

      <div
        class="overflow-hidden rounded-lg bg-card"
        style="box-shadow: var(--shadow-card)"
      >
        <div class="grid grid-cols-[96px_120px_minmax(0,1fr)_92px] gap-3 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground shadow-[inset_0_-1px_0_0_var(--border)]">
          <div>PID</div>
          <div>进程</div>
          <div>监听地址</div>
          <div class="text-right">操作</div>
        </div>

        <div v-if="results.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
          <span v-if="searchedPort">端口 {{ searchedPort }} 暂无监听进程</span>
          <span v-else>输入端口号后查询占用情况</span>
        </div>

        <div
          v-for="process in results"
          :key="`${process.pid}:${process.address}`"
          class="grid grid-cols-[96px_120px_minmax(0,1fr)_92px] items-center gap-3 px-3 py-2.5 shadow-[inset_0_-1px_0_0_var(--border)] last:shadow-none"
        >
          <div class="font-mono text-xs tabular-nums">{{ process.pid }}</div>
          <div class="min-w-0" :title="processTooltip(process)">
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="truncate text-sm font-medium">{{ process.command || 'unknown' }}</span>
              <span
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
                :class="processRoleClass(process.process_role)"
              >
                {{ process.process_role || '独立进程' }}
              </span>
            </div>
            <div class="mt-0.5 truncate text-[10px] text-muted-foreground">
              <span v-if="process.user">{{ process.user }}</span>
              <span v-if="process.parent_pid" class="ml-1 font-mono tabular-nums">PPID {{ process.parent_pid }}</span>
            </div>
          </div>
          <div class="min-w-0">
            <div class="truncate font-mono text-xs tabular-nums">{{ process.address }}</div>
            <div
              class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
              :title="process.full_command || process.raw"
            >
              {{ process.full_command || `${process.protocol || 'TCP'} · ${process.port}` }}
            </div>
          </div>
          <div class="text-right">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              class="h-7 px-2"
              :disabled="killingPid !== null"
              @click="requestKill(process)"
            >
              Kill
            </Button>
          </div>
        </div>
      </div>

    </div>
  </DialogFrame>

  <AlertDialog
    :open="!!pendingKill"
    @update:open="(value) => { if (!value) cancelKill() }"
  >
    <AlertDialogContent class="w-[min(calc(100vw-2rem),32rem)] border-0 bg-card p-0 shadow-[var(--shadow-card)]">
      <div class="min-w-0 px-5 pt-5">
        <AlertDialogHeader>
          <AlertDialogTitle class="text-base tracking-[-0.32px]">确认结束进程</AlertDialogTitle>
          <AlertDialogDescription class="leading-6">
            将请求结束该进程；Windows 会强制结束该进程树。
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div v-if="pendingKill" class="mt-4 min-w-0 rounded-md bg-muted px-3 py-2" style="box-shadow: var(--shadow-border)">
          <div class="min-w-0 text-xs leading-5 text-muted-foreground">
            将结束 PID <span class="font-mono text-foreground">{{ pendingKill.pid }}</span>
            <span class="ml-1 break-all font-mono text-foreground">{{ pendingKill.command || 'unknown' }}</span>
          </div>
          <div class="mt-1 text-xs text-muted-foreground">
            {{ pendingKill.process_role || '独立进程' }}
            <span v-if="pendingKill.parent_pid" class="font-mono tabular-nums"> · PPID {{ pendingKill.parent_pid }}</span>
          </div>
          <div
            v-if="pendingKill.full_command"
            class="mt-1 max-h-16 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-4 text-muted-foreground"
            :title="pendingKill.full_command"
          >
            {{ pendingKill.full_command }}
          </div>
        </div>
      </div>

      <AlertDialogFooter class="bg-muted/40 px-5 py-3 shadow-[inset_0_1px_0_0_var(--border)]">
        <Button
          type="button"
          variant="outline"
          class="mt-0"
          :disabled="killingPid !== null"
          @click="cancelKill"
        >
          取消
        </Button>
        <Button
          type="button"
          variant="destructive"
          class="bg-destructive/10 text-destructive hover:bg-destructive/20"
          :disabled="killingPid !== null"
          @click="confirmKill"
        >
          {{ killingPid === pendingKill?.pid ? '结束中' : '确认 Kill' }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
