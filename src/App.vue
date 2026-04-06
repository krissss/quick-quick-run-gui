<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// 视图状态: 'settings' | 'running'
const view = ref<'settings' | 'running'>('settings')

// 表单数据
const command = ref('')
const url = ref('http://localhost:3000')
const loading = ref(false)
const message = ref('')
const message_type = ref<'success' | 'error' | 'info'>('info')
const pid = ref<number | null>(null)

// 窗口配置
const winWidth = ref(1200)
const winHeight = ref(800)

// 命令历史
const history = ref<string[]>([])
const showHistory = ref(false)
const MAX_HISTORY = 20

// 服务就绪检测
const checkingReady = ref(false)
const readyTimeout = ref(15)

// localStorage keys
const LS_KEY_CMD = 'qqr-command'
const LS_KEY_URL = 'qqr-url'
const LS_KEY_HISTORY = 'qqr-history'
const LS_KEY_WIN_W = 'qqr-win-w'
const LS_KEY_WIN_H = 'qqr-win-h'

onMounted(() => {
  const savedCmd = localStorage.getItem(LS_KEY_CMD)
  const savedUrl = localStorage.getItem(LS_KEY_URL)
  if (savedCmd) command.value = savedCmd
  if (savedUrl) url.value = savedUrl

  const savedW = localStorage.getItem(LS_KEY_WIN_W)
  const savedH = localStorage.getItem(LS_KEY_WIN_H)
  if (savedW) winWidth.value = Number(savedW)
  if (savedH) winHeight.value = Number(savedH)

  try {
    const raw = localStorage.getItem(LS_KEY_HISTORY)
    if (raw) history.value = JSON.parse(raw)
  } catch { /* ignore */ }
})

function saveToHistory(cmd: string) {
  if (!cmd.trim()) return
  let h = history.value.filter(c => c !== cmd)
  h.unshift(cmd)
  h = h.slice(0, MAX_HISTORY)
  history.value = h
  localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(h))
}

function selectFromHistory(item: string) {
  command.value = item
  showHistory.value = false
}

function hideHistory() {
  setTimeout(() => { showHistory.value = false }, 200)
}

function showMessage(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  message.value = msg
  message_type.value = type
  setTimeout(() => { message.value = '' }, 5000)
}

async function handleLaunch() {
  if (!command.value.trim()) {
    showMessage('请输入启动命令', 'error')
    return
  }
  if (!url.value.trim()) {
    showMessage('请输入要加载的 URL', 'error')
    return
  }

  loading.value = true
  try {
    localStorage.setItem(LS_KEY_CMD, command.value)
    localStorage.setItem(LS_KEY_URL, url.value)
    localStorage.setItem(LS_KEY_WIN_W, String(winWidth.value))
    localStorage.setItem(LS_KEY_WIN_H, String(winHeight.value))

    const result = await invoke<string>('launch_command', { command: command.value })
    showMessage(result, 'success')

    saveToHistory(command.value)

    await invoke('resize_window', { width: winWidth.value, height: winHeight.value }).catch(() => {})

    checkingReady.value = true
    const reachable = await invoke<boolean>('check_url_reachable', {
      url: url.value,
      timeoutSecs: readyTimeout.value,
    })
    checkingReady.value = false

    if (!reachable) {
      showMessage(`${readyTimeout.value}秒内未检测到服务就绪，仍尝试加载...`, 'error')
    }

    await invoke('navigate_to_url', { url: url.value })
    view.value = 'running'

    invoke('set_dock_icon_from_url', { url: url.value }).catch(() => {})
    invoke('set_window_title_from_url', { url: url.value }).catch(() => {})
  } catch (e: any) {
    showMessage(`启动失败: ${e}`, 'error')
    loading.value = false
    checkingReady.value = false
  }
}

async function handleStop() {
  try {
    const result = await invoke<string>('kill_process')
    showMessage(result, 'success')
    pid.value = null
  } catch (e: any) {
    showMessage(e, 'error')
  }
}

async function goBackToSettings() {
  await handleStop()
  invoke('reset_dock_icon').catch(() => {})
  await invoke('navigate_to_settings', { devUrl: window.location.origin })
  view.value = 'settings'
  loading.value = false
}
</script>

<template>
  <!-- 设置页面 -->
  <div v-if="view === 'settings'" class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4">
    <div class="w-full max-w-xl rounded-2xl border border-border bg-card/60 backdrop-blur-md p-8 space-y-5">
      <div class="text-center space-y-1">
        <h1 class="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-violet-500 bg-clip-text text-transparent">
          Quick Quick Run GUI
        </h1>
        <p class="text-xs text-muted-foreground">通用 Web App 包装器 — 输入命令，加载 URL，即刻运行</p>
      </div>

      <!-- 消息提示 -->
      <div
        v-if="message"
        :class="[
          'px-3 py-2 rounded-lg text-xs',
          message_type === 'success' && 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
          message_type === 'error' && 'bg-red-500/10 text-red-400 border border-red-500/20',
          message_type === 'info' && 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
        ]"
      >
        {{ message }}
      </div>

      <!-- 命令输入 -->
      <div class="space-y-1.5">
        <label class="text-xs font-semibold text-muted-foreground">启动命令</label>
        <div class="relative">
          <Input
            v-model="command"
            placeholder="例如: cd ~/my-app && npm run dev"
            @focus="showHistory = history.length > 0"
            @blur="hideHistory"
          />
          <!-- 历史下拉 -->
          <div
            v-if="showHistory && history.length > 0"
            class="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover/95 backdrop-blur-sm z-50"
          >
            <div
              v-for="(item, idx) in history"
              :key="idx"
              class="px-3 py-2 text-xs text-muted-foreground truncate cursor-pointer hover:bg-accent/50 transition-colors"
              @mousedown.prevent="selectFromHistory(item)"
            >
              {{ item }}
            </div>
          </div>
        </div>
        <p class="text-[11px] text-muted-foreground/60">支持 cd、&&、管道等完整 shell 语法</p>
      </div>

      <!-- URL 输入 -->
      <div class="space-y-1.5">
        <label class="text-xs font-semibold text-muted-foreground">目标 URL</label>
        <Input v-model="url" placeholder="例如: http://localhost:3000" />
        <p class="text-[11px] text-muted-foreground/60">启动命令后，WebView 将导航到此地址</p>
      </div>

      <!-- 窗口大小 -->
      <div class="space-y-1.5">
        <label class="text-xs font-semibold text-muted-foreground">窗口尺寸</label>
        <div class="flex gap-3">
          <div class="flex items-center gap-2 flex-1 text-xs text-muted-foreground">
            <span>宽度</span>
            <Input v-model="winWidth" type="number" class="w-20 text-center" />
          </div>
          <div class="flex items-center gap-2 flex-1 text-xs text-muted-foreground">
            <span>高度</span>
            <Input v-model="winHeight" type="number" class="w-20 text-center" />
          </div>
        </div>
      </div>

      <!-- 启动按钮 -->
      <Button
        class="w-full h-11 text-sm font-semibold"
        :disabled="loading || checkingReady"
        @click="handleLaunch"
      >
        <span v-if="checkingReady" class="inline-block w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
        {{ checkingReady ? '等待服务就绪...' : loading ? '启动中...' : '启动' }}
      </Button>

      <!-- 底部信息 -->
      <div class="text-center text-[11px] text-muted-foreground/50 space-y-0.5">
        <p>PID: <code class="bg-secondary/50 px-1.5 py-0.5 rounded text-muted-foreground">{{ pid ?? '-' }}</code></p>
        <p v-if="history.length > 0">已保存 {{ history.length }} 条命令历史</p>
      </div>
    </div>
  </div>

  <!-- 运行中工具栏 -->
  <div v-if="view === 'running'" class="fixed top-0 inset-x-0 h-10 flex items-center gap-2.5 px-3 bg-background/95 backdrop-blur-sm border-b border-border z-[9999]">
    <Button variant="secondary" size="sm" @click="goBackToSettings">返回设置</Button>
    <span class="flex-1 text-[11px] text-muted-foreground truncate">{{ url }}</span>
    <Button variant="destructive" size="sm" @click="handleStop">停止进程</Button>
  </div>
</template>
