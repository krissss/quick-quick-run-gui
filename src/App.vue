<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadApps, saveApps, exportData, importData, type AppItem } from '@/lib/store'
import { getTheme, setTheme, type Theme } from '@/lib/theme'
import { save } from '@tauri-apps/plugin-dialog'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { writeFile, readTextFile } from '@tauri-apps/plugin-fs'
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from '@tauri-apps/plugin-autostart'
import { Switch } from '@/components/ui/switch'

// ── 状态 ──
const loading = ref(false)
const message = ref('')
const message_type = ref<'success' | 'error' | 'info'>('info')
const runningAppIds = ref<Set<string>>(new Set())
const apps = ref<AppItem[]>([])

// ── 拖拽排序 ──
const draggedId = ref<string | null>(null)
const draggedOverId = ref<string | null>(null)
const dragOffset = ref({ x: 0, y: 0 })
const isDragging = ref(false)
const dragEl = ref<HTMLElement | null>(null)

function onMouseDown(appId: string, event: MouseEvent) {
  // 只在左侧区域按下才能拖拽（避免误触）
  const target = event.target as HTMLElement
  const card = target.closest('.app-card') as HTMLElement

  // 计算鼠标相对于卡片的位置
  const rect = card!.getBoundingClientRect()
  dragOffset.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }

  draggedId.value = appId
  isDragging.value = false
  dragEl.value = card

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)

  event.preventDefault()
}

function onMouseMove(event: MouseEvent) {
  if (!dragEl.value || !draggedId.value) return

  isDragging.value = true

  // 移动拖拽中的元素
  const card = dragEl.value
  card.style.position = 'fixed'
  card.style.zIndex = '1000'
  card.style.pointerEvents = 'none'
  card.style.opacity = '0.8'
  card.style.left = (event.clientX - dragOffset.value.x) + 'px'
  card.style.top = (event.clientY - dragOffset.value.y) + 'px'

  // 检测下方的卡片
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const dropTarget = target?.closest('.app-card') as HTMLElement

  // 清除之前的高亮
  document.querySelectorAll('.app-card').forEach(el => {
    if (el !== card) {
      el.classList.remove('border-primary/50')
    }
  })

  if (dropTarget && dropTarget !== card) {
    const appId = dropTarget.dataset.appId
    if (appId && appId !== draggedId.value) {
      draggedOverId.value = appId
      dropTarget.classList.add('border-primary/50')
    }
  } else {
    draggedOverId.value = null
  }
}

function onMouseUp() {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)

  if (!dragEl.value || !draggedId.value) {
    draggedId.value = null
    dragEl.value = null
    return
  }

  const card = dragEl.value

  // 恢复样式
  card.style.position = ''
  card.style.zIndex = ''
  card.style.pointerEvents = ''
  card.style.opacity = ''
  card.style.left = ''
  card.style.top = ''

  // 清除高亮
  document.querySelectorAll('.app-card').forEach(el => {
    el.classList.remove('border-primary/50')
  })

  // 如果发生了拖拽且有目标，执行排序
  if (isDragging.value && draggedOverId.value && draggedOverId.value !== draggedId.value) {
    const fromIndex = apps.value.findIndex(a => a.id === draggedId.value)
    const toIndex = apps.value.findIndex(a => a.id === draggedOverId.value)

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      const [moved] = apps.value.splice(fromIndex, 1)
      apps.value.splice(toIndex, 0, moved)
      persistApps()
      console.log('排序完成', { fromIndex, toIndex })
    }
  }

  draggedId.value = null
  draggedOverId.value = null
  isDragging.value = false
  dragEl.value = null
}

// ── 主题 ──
const currentTheme = ref<Theme>(getTheme())
function toggleTheme() {
  const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
  currentTheme.value = next[currentTheme.value]
  setTheme(currentTheme.value)
}
const themeIcon = computed(() => {
  if (currentTheme.value === 'light') return '☀️'
  if (currentTheme.value === 'dark') return '🌙'
  return '💻'
})
const themeLabel = computed(() => {
  if (currentTheme.value === 'light') return '亮色'
  if (currentTheme.value === 'dark') return '暗色'
  return '跟随系统'
})

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
  // 通知 Rust 重建托盘菜单
  try { await invoke('notify_apps_updated') } catch { /* ignore */ }
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

  // 托盘菜单点击启动应用
  await listen<string>('tray-launch-app', async (e) => {
    const app = apps.value.find(a => a.id === e.payload)
    if (app) await launchApp(app)
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
  if (!editForm.value.name.trim() || !editForm.value.url.trim()) {
    showMessage('请填写应用名称和目标 URL', 'error')
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
function getBackgroundRGB(): [number, number, number] {
  const rgb = getComputedStyle(document.body).backgroundColor
  const m = rgb.match(/\d+/g)
  if (m && m.length >= 3) return [+m[0], +m[1], +m[2]]
  return [255, 255, 255]
}

async function launchApp(app: AppItem) {
  loading.value = true
  try {
    const [bgR, bgG, bgB] = getBackgroundRGB()
    const result = await invoke<string>('launch_app_window', {
      appId: app.id,
      command: app.command,
      url: app.url,
      width: app.width,
      height: app.height,
      appName: app.name,
      bgR,
      bgG,
      bgB,
    })
    showMessage(result, 'success')
    // 有命令时自动打开日志弹窗
    if (app.command.trim()) {
      openLogDialog(app)
    }
  } catch (e: any) {
    showMessage(`启动失败: ${e}`, 'error')
  }
  loading.value = false
}

// ── 导入/导出 ──
async function handleExport() {
  try {
    const json = await exportData()
    const filePath = await save({
      defaultPath: 'qqr-apps-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!filePath) return // 用户取消
    await writeFile(filePath, new TextEncoder().encode(json))
    showMessage(`已导出到 ${filePath}`, 'success')
  } catch (e: any) {
    showMessage(`导出失败: ${e}`, 'error')
  }
}

async function handleImport() {
  try {
    const filePath = await dialogOpen({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    })
    if (!filePath) return // 用户取消
    const json = await readTextFile(filePath)
    const imported = await importData(json)
    apps.value = imported
    showMessage(`已导入 ${imported.length} 个应用`, 'success')
    try { await invoke('notify_apps_updated') } catch { /* ignore */ }
  } catch (e: any) {
    showMessage(`导入失败: ${e}`, 'error')
  }
}

// ── 消息 ──
function showMessage(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  message.value = msg
  message_type.value = type
  setTimeout(() => { message.value = '' }, 5000)
}

const messageClass = computed(() => {
  const m = message_type.value
  if (m === 'success') return 'bg-primary/10 text-primary border-primary/20'
  if (m === 'error') return 'bg-destructive/10 text-destructive border-destructive/20'
  return 'bg-secondary text-secondary-foreground border-border'
})

// ── 日志查看器 ──
const showLogDialog = ref(false)
const logAppId = ref('')
const logAppName = ref('')
const logLines = ref<string[]>([])
const logContainer = ref<HTMLElement | null>(null)
const logLaunchFailed = ref(false)
const logLaunchFailedReason = ref('')
let logUnlisten: (() => void) | null = null
let logFailedUnlisten: (() => void) | null = null

async function openLogDialog(app: AppItem) {
  logAppId.value = app.id
  logAppName.value = app.name
  logLaunchFailed.value = false
  logLaunchFailedReason.value = ''
  logLines.value = await invoke<string[]>('get_app_logs', { appId: app.id })
  showLogDialog.value = true

  // 实时监听新日志
  logUnlisten = await listen<{ app_id: string; lines: string[] }>('app-log-batch', (e) => {
    if (e.payload.app_id === logAppId.value) {
      logLines.value.push(...e.payload.lines)
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight
        }
      })
    }
  })

  // 监听启动失败
  logFailedUnlisten = await listen<{ app_id: string; reason: string }>('app-launch-failed', (e) => {
    if (e.payload.app_id === logAppId.value) {
      logLaunchFailed.value = true
      logLaunchFailedReason.value = e.payload.reason
    }
  })
}

function closeLogDialog() {
  showLogDialog.value = false
  if (logUnlisten) {
    logUnlisten()
    logUnlisten = null
  }
  if (logFailedUnlisten) {
    logFailedUnlisten()
    logFailedUnlisten = null
  }
}

// ── 设置 ──
const showSettingsDialog = ref(false)
const autostartEnabled = ref(false)

async function openSettingsDialog() {
  showSettingsDialog.value = true
  try {
    autostartEnabled.value = await autostartIsEnabled()
  } catch {
    autostartEnabled.value = false
  }
}

async function toggleAutostart(value: boolean) {
  try {
    if (value) {
      await autostartEnable()
      autostartEnabled.value = true
    } else {
      await autostartDisable()
      autostartEnabled.value = false
    }
  } catch (e: any) {
    showMessage(`设置自启动失败: ${e}`, 'error')
  }
}

function closeSettingsDialog() {
  showSettingsDialog.value = false
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="p-6 max-w-4xl mx-auto">
      <!-- 标题 -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-bold bg-gradient-to-r from-[oklch(0.55_0.12_40)] to-[oklch(0.50_0.10_30)] bg-clip-text text-transparent">
            Quick Quick Run GUI
          </h1>
          <p class="text-xs text-muted-foreground mt-0.5">点击启动应用，或添加新配置</p>
        </div>
        <div class="flex gap-1.5 items-center">
          <Button variant="ghost" size="sm" @click="openSettingsDialog" class="text-xs px-2" title="设置">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </Button>
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
          class="app-card group relative rounded-2xl border-0 bg-gradient-to-br from-card to-card/80 backdrop-blur-sm p-4 cursor-pointer hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 transition-all duration-200"
          :class="{
            'opacity-50': draggedId === app.id,
            'ring-2 ring-primary/50': draggedOverId === app.id && draggedId !== app.id
          }"
          :data-app-id="app.id"
          @click="openEditDialog(app)"
        >
          <!-- 拖拽手柄区域（左侧） -->
          <div
            class="absolute top-0 left-0 w-8 h-full rounded-l-2xl cursor-grab active:cursor-grabbing hover:bg-accent/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-start justify-center pt-2"
            @mousedown.stop="onMouseDown(app.id, $event)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground">
              <circle cx="9" cy="12" r="1"/>
              <circle cx="9" cy="5" r="1"/>
              <circle cx="9" cy="19" r="1"/>
              <circle cx="15" cy="12" r="1"/>
              <circle cx="15" cy="5" r="1"/>
              <circle cx="15" cy="19" r="1"/>
            </svg>
          </div>

          <!-- 运行指示器 + 日志按钮 -->
          <div class="absolute top-2 left-2 flex items-center gap-2">
            <div
              v-if="runningAppIds.has(app.id)"
              class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
              title="运行中"
            />
            <button
              v-if="runningAppIds.has(app.id) && app.command"
              class="w-6 h-6 rounded-full bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground flex items-center justify-center text-xs transition-colors"
              title="查看日志"
              @click.stop="openLogDialog(app)"
            >
              ☰
            </button>
          </div>

          <!-- 右上角启动按钮 -->
          <button
            class="absolute top-[22px] right-4 w-8 h-8 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center shadow-md hover:shadow-lg transition-all"
            title="启动应用"
            @click.stop="launchApp(app)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>

          <!-- 图标 -->
          <div class="w-14 h-14 rounded-2xl mb-3 flex items-center justify-center bg-gradient-to-br shadow-inner"
               :class="iconGradient(app.name)">
            <span class="text-xl font-bold text-white">{{ app.name.charAt(0).toUpperCase() }}</span>
          </div>
          <h3 class="text-sm font-semibold truncate">{{ app.name }}</h3>
          <p class="text-[11px] text-muted-foreground truncate mt-0.5">{{ app.url }}</p>

          <!-- 加载中遮罩 -->
          <div
            v-if="loading && runningAppIds.size === 0 && apps.findIndex(a => a.id === app.id) >= 0"
            class="absolute inset-0 rounded-xl bg-background/80 flex items-center justify-center"
          >
            <span class="inline-block w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
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
              <label class="text-xs font-medium text-muted-foreground">启动命令 <span class="text-muted-foreground/40 font-normal">(可选)</span></label>
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

    <!-- ═══ 日志查看器 ═══ -->
    <Teleport to="body">
      <div
        v-if="showLogDialog"
        class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        @click.self="closeLogDialog"
      >
        <div class="bg-card rounded-xl border border-border p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-semibold">{{ logAppName }} — 日志</h2>
            <div v-if="!logLaunchFailed && runningAppIds.has(logAppId)" class="flex items-center gap-1.5">
              <span class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span class="text-xs text-muted-foreground">启动中</span>
            </div>
            <span v-if="logLaunchFailed" class="text-xs text-red-500 font-medium">
              {{ logLaunchFailedReason === 'process_exited' ? '进程已退出' : '启动超时' }}
            </span>
          </div>
          <div
            ref="logContainer"
            class="flex-1 overflow-y-auto bg-background rounded-lg border border-border p-3 font-mono text-xs min-h-0"
          >
            <div v-for="(line, i) in logLines" :key="i" class="whitespace-pre-wrap break-all text-foreground/80 hover:text-foreground">{{ line }}</div>
            <div v-if="logLines.length === 0" class="text-muted-foreground text-center py-8">暂无日志</div>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <Button v-if="logLaunchFailed" variant="destructive" size="sm" @click="() => { const app = apps.find(a => a.id === logAppId); if (app) launchApp(app) }">重新启动</Button>
            <Button variant="secondary" size="sm" @click="closeLogDialog">关闭</Button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ═══ 设置弹窗 ═══ -->
    <Teleport to="body">
      <div
        v-if="showSettingsDialog"
        class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        @click.self="closeSettingsDialog"
      >
        <div class="bg-card rounded-xl border border-border p-6 w-full max-w-sm space-y-4">
          <h2 class="text-base font-semibold">设置</h2>

          <div class="space-y-1">
            <!-- 开机自启动 -->
            <div class="flex items-center justify-between py-2">
              <div>
                <div class="text-sm font-medium">开机自启动</div>
                <div class="text-xs text-muted-foreground">登录时自动启动应用</div>
              </div>
              <Switch :model-value="autostartEnabled" @update:model-value="toggleAutostart" />
            </div>

            <div class="border-t border-border" />

            <!-- 外观主题 -->
            <div class="flex items-center justify-between py-2">
              <div>
                <div class="text-sm font-medium">外观主题</div>
                <div class="text-xs text-muted-foreground">{{ themeLabel }}</div>
              </div>
              <Button variant="ghost" size="sm" @click="toggleTheme" class="text-xs px-2">{{ themeIcon }}</Button>
            </div>

            <div class="border-t border-border" />

            <!-- 数据导入导出 -->
            <div class="flex items-center justify-between py-2">
              <div>
                <div class="text-sm font-medium">数据管理</div>
                <div class="text-xs text-muted-foreground">导入或导出应用配置</div>
              </div>
              <div class="flex gap-1.5">
                <Button variant="ghost" size="sm" @click="handleImport" class="text-xs">导入</Button>
                <Button variant="ghost" size="sm" @click="handleExport" class="text-xs">导出</Button>
              </div>
            </div>
          </div>

          <div class="flex justify-end pt-2">
            <Button variant="secondary" size="sm" @click="closeSettingsDialog">关闭</Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
