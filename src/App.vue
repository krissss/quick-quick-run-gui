<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

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
const readyTimeout = ref(15) // 默认等待 15 秒

// localStorage keys
const LS_KEY_CMD = 'qqr-command'
const LS_KEY_URL = 'qqr-url'
const LS_KEY_HISTORY = 'qqr-history'
const LS_KEY_WIN_W = 'qqr-win-w'
const LS_KEY_WIN_H = 'qqr-win-h'

onMounted(() => {
  // 恢复上次输入
  const savedCmd = localStorage.getItem(LS_KEY_CMD)
  const savedUrl = localStorage.getItem(LS_KEY_URL)
  if (savedCmd) command.value = savedCmd
  if (savedUrl) url.value = savedUrl

  // 恢复窗口大小
  const savedW = localStorage.getItem(LS_KEY_WIN_W)
  const savedH = localStorage.getItem(LS_KEY_WIN_H)
  if (savedW) winWidth.value = Number(savedW)
  if (savedH) winHeight.value = Number(savedH)

  // 恢复命令历史
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
    // 保存到 localStorage
    localStorage.setItem(LS_KEY_CMD, command.value)
    localStorage.setItem(LS_KEY_URL, url.value)
    localStorage.setItem(LS_KEY_WIN_W, String(winWidth.value))
    localStorage.setItem(LS_KEY_WIN_H, String(winHeight.value))

    // 启动命令
    const result = await invoke<string>('launch_command', {
      command: command.value,
    })
    showMessage(result, 'success')

    // 保存到历史
    saveToHistory(command.value)

    // 调整窗口大小
    await invoke('resize_window', { width: winWidth.value, height: winHeight.value }).catch(() => {})

    // 等待服务就绪
    checkingReady.value = true
    const reachable = await invoke<boolean>('check_url_reachable', {
      url: url.value,
      timeoutSecs: readyTimeout.value,
    })
    checkingReady.value = false

    if (!reachable) {
      showMessage(`⚠️ ${readyTimeout.value}秒内未检测到服务就绪，仍尝试加载...`, 'error')
    }

    // 导航到目标 URL
    await invoke('navigate_to_url', { url: url.value })
    view.value = 'running'
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
  // 使用 Rust 命令导航回设置页（自动区分 dev/prod）
  await invoke('navigate_to_settings', { devUrl: window.location.origin })
  view.value = 'settings'
  loading.value = false
}
</script>

<template>
  <div class="app">
    <!-- 设置页面 -->
    <div v-if="view === 'settings'" class="settings-page">
      <div class="container">
        <h1 class="title">⚡ Quick Quick Run GUI</h1>
        <p class="subtitle">通用 Web App 包装器 — 输入命令，加载 URL，即刻运行</p>

        <!-- 消息提示 -->
        <div v-if="message" :class="['message', `message-${message_type}`]">
          {{ message }}
        </div>

        <!-- 命令输入（带历史） -->
        <div class="form-group">
          <label for="command">🚀 启动命令</label>
          <div class="input-with-history">
            <input
              id="command"
              v-model="command"
              type="text"
              placeholder="例如: cd ~/Softs/my-app && ./my-server --port 8080"
              class="input"
              @focus="showHistory = history.length > 0"
              @blur="setTimeout(() => showHistory = false, 200)"
            />
            <!-- 历史下拉 -->
            <div v-if="showHistory && history.length > 0" class="history-dropdown">
              <div
                v-for="(item, idx) in history"
                :key="idx"
                class="history-item"
                @mousedown.prevent="selectFromHistory(item)"
              >
                <span class="history-icon">📋</span>
                <span class="history-text">{{ item }}</span>
              </div>
            </div>
          </div>
          <span class="hint">支持 cd、&&、管道等完整 shell 语法</span>
        </div>

        <!-- URL 输入 -->
        <div class="form-group">
          <label for="url">🌐 目标 URL</label>
          <input
            id="url"
            v-model="url"
            type="text"
            placeholder="例如: http://localhost:3000"
            class="input"
          />
          <span class="hint">启动命令后，WebView 将导航到此地址（会自动检测服务是否就绪）</span>
        </div>

        <!-- 窗口大小 -->
        <div class="form-group">
          <label>🖥 窗口尺寸</label>
          <div class="row-inputs">
            <div class="size-field">
              <span>宽度</span>
              <input v-model.number="winWidth" type="number" min="400" max="3840" class="input-sm" />
            </div>
            <div class="size-field">
              <span>高度</span>
              <input v-model.number="winHeight" type="number" min="300" max="2160" class="input-sm" />
            </div>
          </div>
          <span class="hint">启动后自动调整窗口大小</span>
        </div>

        <!-- 操作按钮 -->
        <button
          class="btn btn-primary"
          :disabled="loading || checkingReady"
          @click="handleLaunch"
        >
          <span v-if="checkingReady" class="spinner"></span>
          {{ checkingReady ? '等待服务就绪...' : loading ? '启动中...' : '▶ 启动' }}
        </button>

        <div class="footer">
          <p>进程 PID: <code>{{ pid ?? '-' }}</code></p>
          <p v-if="history.length > 0" class="history-count">已保存 {{ history.length }} 条命令历史</p>
        </div>
      </div>
    </div>

    <!-- 运行中页面（顶部工具栏） -->
    <div v-if="view === 'running'" class="toolbar">
      <button class="btn btn-sm btn-secondary" @click="goBackToSettings">
        ← 返回设置
      </button>
      <span class="toolbar-info">{{ url }}</span>
      <button class="btn btn-sm btn-danger" @click="handleStop">
        ⏹ 停止进程
      </button>
    </div>
  </div>
</template>

<style scoped>
.app {
  width: 100%;
  min-height: 100vh;
}

.settings-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #e0e0e0;
}

.container {
  width: 90%;
  max-width: 600px;
  padding: 36px 32px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.title {
  font-size: 26px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 6px;
  background: linear-gradient(90deg, #00d4ff, #7b2ff7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  text-align: center;
  font-size: 13px;
  color: #888;
  margin: 0 0 28px;
}

.form-group {
  margin-bottom: 18px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 5px;
  color: #ccc;
}

.input-with-history {
  position: relative;
}

.input {
  width: 100%;
  padding: 11px 14px;
  font-size: 14px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
  font-family: inherit;
}

.input:focus {
  border-color: #00d4ff;
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15);
}

.input::placeholder {
  color: #555;
}

.hint {
  display: block;
  font-size: 11px;
  color: #666;
  margin-top: 4px;
}

/* 历史下拉 */
.history-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 4px;
  background: rgba(20, 20, 35, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  z-index: 100;
  backdrop-filter: blur(10px);
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: pointer;
  transition: background 0.15s;
  font-size: 13px;
}

.history-item:hover {
  background: rgba(0, 212, 255, 0.08);
}

.history-icon {
  flex-shrink: 0;
  font-size: 12px;
}

.history-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #bbb;
}

/* 窗口尺寸 */
.row-inputs {
  display: flex;
  gap: 12px;
}

.size-field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #aaa;
}

.input-sm {
  width: 80px;
  padding: 7px 10px;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  outline: none;
  text-align: center;
}

.input-sm:focus {
  border-color: #00d4ff;
}

/* 按钮 */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 13px 24px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: linear-gradient(90deg, #00d4ff, #7b2ff7);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(0, 212, 255, 0.35);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-sm {
  width: auto;
  padding: 5px 12px;
  font-size: 12px;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
}

.btn-danger {
  background: rgba(255, 70, 70, 0.12);
  color: #ff6b6b;
  border: 1px solid rgba(255, 70, 70, 0.22);
}

.btn-danger:hover {
  background: rgba(255, 70, 70, 0.22);
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 消息提示 */
.message {
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
}

.message-success {
  background: rgba(0, 200, 100, 0.1);
  color: #4ade80;
  border: 1px solid rgba(0, 200, 100, 0.18);
}

.message-error {
  background: rgba(255, 70, 70, 0.1);
  color: #ff6b6b;
  border: 1px solid rgba(255, 70, 70, 0.18);
}

.message-info {
  background: rgba(0, 150, 255, 0.1);
  color: #60a5fa;
  border: 1px solid rgba(0, 150, 255, 0.18);
}

.footer {
  margin-top: 20px;
  text-align: center;
  font-size: 12px;
  color: #555;
}

.footer code {
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  color: #aaa;
}

.history-count {
  margin-top: 4px;
  color: #666;
}

/* 工具栏 */
.toolbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: rgba(18, 18, 28, 0.94);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  z-index: 9999;
}

.toolbar-info {
  flex: 1;
  font-size: 11px;
  color: #777;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 滚动条 */
::-webkit-scrollbar {
  width: 5px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
