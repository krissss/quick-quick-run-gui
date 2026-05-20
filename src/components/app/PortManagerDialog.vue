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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

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

type InspectMode = 'port' | 'name'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  message: [text: string, type?: 'success' | 'error' | 'info']
}>()

const portInput = ref('')
const nameInput = ref('')
const portInputRef = ref<{ focus: () => void } | null>(null)
const nameInputRef = ref<{ focus: () => void } | null>(null)
const inspectMode = ref<InspectMode>('port')
const results = ref<PortProcessInfo[]>([])
const searchedPort = ref<number | null>(null)
const searchedName = ref('')
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

const normalizedName = computed(() => nameInput.value.trim())

const canInspect = computed(() => {
  if (isInspecting.value) return false
  if (inspectMode.value === 'port') return parsedPort.value !== null
  return normalizedName.value.length > 0
})

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  focusCurrentInput()
})

watch(inspectMode, async () => {
  await nextTick()
  focusCurrentInput()
})

function setStatus(text: string, type: 'success' | 'error' | 'info' = 'info', options: { toast?: boolean } = {}) {
  statusMessage.value = text
  statusType.value = type
  if (options.toast !== false) emit('message', text, type)
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
    `协议: ${process.protocol || '-'}`,
    `端口: ${process.port || '-'}`,
    `进程: ${process.command || 'unknown'}`,
    `命令: ${process.full_command || process.raw || '-'}`,
  ].join('\n')
}

function processTitle(process: PortProcessInfo) {
  return process.command || 'unknown'
}

function processCommandLine(process: PortProcessInfo) {
  const line = process.full_command?.trim() || process.raw?.trim() || ''
  const title = process.command?.trim() || ''
  if (!line || line === title) return ''
  return line
}

function processMeta(process: PortProcessInfo) {
  const items = [
    process.user ? `用户 ${process.user}` : '',
    process.parent_pid ? `PPID ${process.parent_pid}` : '',
  ].filter(Boolean)
  return items.join(' · ') || '无 PPID'
}

function processSummaryText(process: PortProcessInfo) {
  if (inspectMode.value === 'port') {
    return `监听 ${process.address || `${process.protocol || 'TCP'} · ${process.port || '-'}`}`
  }
  const query = searchedName.value || normalizedName.value
  if (!query) return '名称匹配'
  const lowerQuery = query.toLowerCase()
  const command = process.command?.toLowerCase() || ''
  const fullCommand = process.full_command?.toLowerCase() || process.raw?.toLowerCase() || ''
  if (command.includes(lowerQuery)) return `进程名包含 "${query}"`
  if (fullCommand.includes(lowerQuery)) return `命令行包含 "${query}"`
  return `匹配 "${query}"`
}

function emptyResultText() {
  if (searchedPort.value && inspectMode.value === 'port') return `端口 ${searchedPort.value} 暂无监听进程`
  if (searchedName.value && inspectMode.value === 'name') return `名称 ${searchedName.value} 暂无匹配进程`
  return inspectMode.value === 'port' ? '输入端口号后查询占用情况' : '输入进程名称后查询匹配进程'
}

function focusCurrentInput() {
  if (inspectMode.value === 'port') {
    portInputRef.value?.focus()
  } else {
    nameInputRef.value?.focus()
  }
}

async function inspectProcesses(options: { keepStatus?: boolean } = {}) {
  if (!parsedPort.value) {
    if (inspectMode.value === 'port') {
      setStatus('请输入 1 到 65535 之间的端口号', 'error')
      return
    }
  }
  if (inspectMode.value === 'name' && !normalizedName.value) {
    setStatus('请输入进程名称', 'error')
    return
  }

  isInspecting.value = true
  searchedPort.value = inspectMode.value === 'port' ? parsedPort.value : null
  searchedName.value = inspectMode.value === 'name' ? normalizedName.value : ''
  if (!options.keepStatus) statusMessage.value = ''
  try {
    results.value = inspectMode.value === 'port'
      ? await invoke<PortProcessInfo[]>('inspect_port', { port: parsedPort.value })
      : await invoke<PortProcessInfo[]>('inspect_process_name', { query: normalizedName.value })
    if (results.value.length === 0 && !options.keepStatus) {
      setStatus(inspectMode.value === 'port'
        ? `端口 ${parsedPort.value} 当前没有监听进程`
        : `名称 ${normalizedName.value} 当前没有匹配进程`, 'info', { toast: false })
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
  const query = searchedName.value || normalizedName.value
  killingPid.value = pid
  cancelKill()
  setStatus(inspectMode.value === 'port'
    ? `正在结束 PID ${pid}（端口 ${port}）...`
    : `正在结束 PID ${pid}（名称 ${query}）...`, 'info')
  try {
    const result = inspectMode.value === 'port'
      ? await invoke<{ message: string }>('kill_port_pid', { port, pid })
      : await invoke<{ message: string }>('kill_process_pid', { query, pid })
    setStatus(result.message || `已结束 PID ${pid}`, 'success')
    await inspectProcesses({ keepStatus: true })
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
    title="进程排查"
    close-label="关闭进程排查"
    panel-class="max-w-3xl"
    :close-disabled="isInspecting || killingPid !== null"
    @close="closeDialog"
  >
    <div class="space-y-4">
      <form class="flex items-center gap-2" @submit.prevent="inspectProcesses()">
        <ToggleGroup
          :model-value="inspectMode"
          type="single"
          class="shrink-0 rounded-md bg-muted p-0.5"
          style="box-shadow: var(--shadow-border)"
          @update:model-value="(value) => { if (value === 'port' || value === 'name') inspectMode = value }"
        >
          <ToggleGroupItem value="port" class="h-8 px-3 text-xs">端口</ToggleGroupItem>
          <ToggleGroupItem value="name" class="h-8 px-3 text-xs">名称</ToggleGroupItem>
        </ToggleGroup>
        <div class="relative flex-1">
          <Input
            v-if="inspectMode === 'port'"
            ref="portInputRef"
            v-model="portInput"
            class="h-9 pr-20 font-mono text-sm tabular-nums"
            clear-button-class="right-12"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            placeholder="3000"
            aria-label="端口号"
          />
          <Input
            v-else
            ref="nameInputRef"
            v-model="nameInput"
            class="h-9 pr-20 font-mono text-sm"
            clear-button-class="right-14"
            type="text"
            placeholder="node"
            aria-label="进程名称"
          />
          <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium uppercase text-muted-foreground">
            {{ inspectMode === 'port' ? 'TCP' : 'NAME' }}
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
        <div class="grid grid-cols-[96px_minmax(0,1fr)_92px] gap-3 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground shadow-[inset_0_-1px_0_0_var(--border)]">
          <div>PID</div>
          <div>进程信息</div>
          <div class="text-right">操作</div>
        </div>

        <div v-if="results.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
          {{ emptyResultText() }}
        </div>

        <div
          v-for="process in results"
          :key="`${process.pid}:${process.address}`"
          class="grid grid-cols-[96px_minmax(0,1fr)_92px] items-start gap-3 px-3 py-3 shadow-[inset_0_-1px_0_0_var(--border)] last:shadow-none"
        >
          <div class="space-y-1">
            <div class="font-mono text-xs tabular-nums">PID {{ process.pid }}</div>
            <span
              class="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
              :class="processRoleClass(process.process_role)"
            >
              {{ process.process_role || '独立进程' }}
            </span>
          </div>
          <div class="min-w-0" :title="processTooltip(process)">
            <div class="truncate text-sm font-medium">
              {{ processTitle(process) }}
            </div>
            <div v-if="processCommandLine(process)" class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {{ processCommandLine(process) }}
            </div>
            <div class="mt-1 flex flex-wrap gap-1">
              <span class="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {{ processMeta(process) }}
              </span>
              <span class="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {{ processSummaryText(process) }}
              </span>
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
