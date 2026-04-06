<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadApps, saveApps, exportData, importData, type AppItem } from '@/lib/store'

// ── 状态 ──
const loading = ref(false)
const message = ref('')
const message_type = ref<'success' | 'error' | 'info'>('info')
const runningAppIds = ref<Set<string>>(new Set())
const apps = ref<AppItem[]>([])

// ── 弹窗 ──
const showDialog = ref(false)
const isEditing = ref(false)
const editForm = ref<AppItem>(emptyApp())

function emptyApp(): AppItem {
  return { id: '', name: '', command: '', url: '', width: 1200, height: 800 }
}

// ── 数据持久化 ──
async function refreshApps() {
  apps.value = await loadApps()
}

async function persistApps() {
  await saveApps(apps.value)
}

// ── 初始化 ──
onMounted(async () => {
  await refreshApps()
  refreshRunningApps()
  await listen<string>('app-launched', (e) => {
    runningAppIds.value.add(e.payload)
  })
  await listen<string>('app-stopped', (e) => {
    runningAppIds.value.delete(e.payload)
  })
})

async function refreshRunningApps() {
  try {
    const ids = await invoke<string[]>('get_running_apps')
    runningAppIds.value = new Set(ids)
  } catch { /* ignore */ }
}

// ── 弹窗操作 ──
function openAddDialog() {
  isEditing.value = false
  editForm.value = emptyApp()
  showDialog.value = true
}

function openEditDialog(app: AppItem) {
  isEditing.value = true
  editForm.value = { ...app }
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
}

async function saveApp() {
  if (!editForm.value.name.trim() || !editForm.value.command.trim() || !editForm.value.url.trim()) {
    showMessage('请填写应用名称、启动命令和目标 URL', 'error')
    return
  }
  if (isEditing.value) {
    const idx = apps.value.findIndex(a => a.id === editForm.value.id)
    if (idx !== -1) apps.value[idx] = { ...editForm.value }
  } else {
    editForm.value.id = crypto.randomUUID()
    apps.value.push({ ...editForm.value })
  }
  await persistApps()
  closeDialog()
}

async function deleteApp() {
  apps.value = apps.value.filter(a => a.id !== editForm.value.id)
  await persistApps()
  closeDialog()
}

// ── 图标颜色 ──
const ICON_COLORS = [
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-violet-500 to-purple-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-blue-500',
]

function iconGradient(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return ICON_COLORS[Math.abs(hash) % ICON_COLORS.length]
}

// ── 启动 ──
async function launchApp(app: AppItem) {
  loading.value = true
  try {
    const result = await invoke<string>('launch_app_window', {
      appId: app.id,
      command: app.command,
      url: app.url,
      width: app.width,
      height: app.height,
      appName: app.name,
    })
    showMessage(result, 'success')
    if (!app.iconUrl) {
      fetchAndSaveIcon(app)
    }
  } catch (e: any) {
    showMessage(`启动失败: ${e}`, 'error')
  }
  loading.value = false
}

// ── Favicon 自动提取 ──
async function fetchAndSaveIcon(app: AppItem) {
  try {
    const dataUrl = await invoke<string>('fetch_favicon_data_url', { url: app.url })
    if (dataUrl) {
      const idx = apps.value.findIndex(a => a.id === app.id)
      if (idx !== -1) {
        apps.value[idx].iconUrl = dataUrl
        await persistApps()
      }
    }
  } catch { /* ignore */ }
}

// ── 导入/导出 ──
async function handleExport() {
  try {
    const json = await exportData()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'qqr-apps-export.json'
    a.click()
    URL.revokeObjectURL(url)
    showMessage('已导出', 'success')
  } catch (e: any) {
    showMessage(`导出失败: ${e}`, 'error')
  }
}

async function handleImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const json = await file.text()
      const imported = await importData(json)
      apps.value = imported
      showMessage(`已导入 ${imported.length} 个应用`, 'success')
    } catch (e: any) {
      showMessage(`导入失败: ${e}`, 'error')
    }
  }
  input.click()
}

// ── 消息 ──
function showMessage(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  message.value = msg
  message_type.value = type
  setTimeout(() => { message.value = '' }, 5000)
}

const messageClass = computed(() => {
  const m = message_type.value
  if (m === 'success') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  if (m === 'error') return 'bg-red-500/10 text-red-400 border-red-500/20'
  return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
})
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-foreground">
    <div class="p-6 max-w-4xl mx-auto">
      <!-- 标题 -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-bold bg-gradient-to-r from-cyan-400 to-violet-500 bg-clip-text text-transparent">
            Quick Quick Run GUI
          </h1>
          <p class="text-xs text-muted-foreground mt-0.5">点击启动应用，或添加新配置</p>
        </div>
        <div class="flex gap-1.5">
          <Button variant="ghost" size="sm" @click="handleImport" class="text-xs">导入</Button>
          <Button variant="ghost" size="sm" @click="handleExport" class="text-xs">导出</Button>
        </div>
      </div>

      <!-- 消息 -->
      <div v-if="message" :class="['px-3 py-2 rounded-lg text-xs border mb-4', messageClass]">
        {{ message }}
      </div>

      <!-- 应用卡片网格 -->
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        <div
          v-for="app in apps"
          :key="app.id"
          class="group relative rounded-xl border border-border bg-card/60 p-4 cursor-pointer hover:bg-accent/30 hover:border-accent/50 transition-all"
          @click="launchApp(app)"
        >
          <!-- 运行指示器 -->
          <div
            v-if="runningAppIds.has(app.id)"
            class="absolute top-2 left-2 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
            title="运行中"
          />

          <!-- 图标 -->
          <div class="w-12 h-12 rounded-xl mb-3 flex items-center justify-center overflow-hidden"
               :class="app.iconUrl ? '' : `bg-gradient-to-br ${iconGradient(app.name)}`">
            <img v-if="app.iconUrl" :src="app.iconUrl" class="w-full h-full object-cover rounded-xl" />
            <span v-else class="text-lg font-bold text-white">{{ app.name.charAt(0).toUpperCase() }}</span>
          </div>
          <h3 class="text-sm font-medium truncate">{{ app.name }}</h3>
          <p class="text-[11px] text-muted-foreground truncate mt-0.5">{{ app.url }}</p>

          <!-- 悬浮操作 -->
          <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            <button
              class="w-6 h-6 rounded-md bg-secondary/80 text-muted-foreground hover:text-foreground flex items-center justify-center text-xs"
              @click.stop="openEditDialog(app)"
            >
              ✎
            </button>
          </div>

          <!-- 加载中遮罩 -->
          <div
            v-if="loading && runningAppIds.size === 0 && apps.findIndex(a => a.id === app.id) >= 0"
            class="absolute inset-0 rounded-xl bg-background/80 flex items-center justify-center"
          >
            <span class="inline-block w-5 h-5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
          </div>
        </div>

        <!-- 添加按钮卡片 -->
        <div
          class="rounded-xl border border-dashed border-border p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/30 hover:border-accent/50 transition-all min-h-[140px]"
          @click="openAddDialog"
        >
          <span class="text-2xl text-muted-foreground">+</span>
          <span class="text-xs text-muted-foreground mt-1">添加应用</span>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="apps.length === 0" class="text-center py-16 text-muted-foreground">
        <p class="text-sm">还没有应用配置</p>
        <p class="text-xs mt-1">点击上方 "+" 添加你的第一个应用</p>
      </div>
    </div>

    <!-- ═══ 添加/编辑弹窗 ═══ -->
    <Teleport to="body">
      <div
        v-if="showDialog"
        class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        @click.self="closeDialog"
      >
        <div class="bg-card rounded-xl border border-border p-6 w-full max-w-md space-y-4">
          <h2 class="text-base font-semibold">{{ isEditing ? '编辑应用' : '添加应用' }}</h2>

          <div class="space-y-3">
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground">应用名称</label>
              <Input v-model="editForm.name" placeholder="例如：我的博客" />
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground">启动命令</label>
              <Input v-model="editForm.command" placeholder="cd ~/my-app && npm run dev" />
              <p class="text-[11px] text-muted-foreground/60">支持 cd、&&、管道等完整 shell 语法</p>
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground">目标 URL</label>
              <Input v-model="editForm.url" placeholder="http://localhost:3000" />
            </div>
            <div class="flex gap-3">
              <div class="flex-1 space-y-1">
                <label class="text-xs font-medium text-muted-foreground">宽度</label>
                <Input v-model.number="editForm.width" type="number" />
              </div>
              <div class="flex-1 space-y-1">
                <label class="text-xs font-medium text-muted-foreground">高度</label>
                <Input v-model.number="editForm.height" type="number" />
              </div>
            </div>
          </div>

          <div class="flex gap-2 justify-end pt-2">
            <Button v-if="isEditing" variant="destructive" size="sm" @click="deleteApp">删除</Button>
            <div class="flex-1" />
            <Button variant="secondary" size="sm" @click="closeDialog">取消</Button>
            <Button size="sm" @click="saveApp">{{ isEditing ? '保存' : '添加' }}</Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
