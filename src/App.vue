<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
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

// ── 右侧面板：编辑表单 ──
const editForm = ref<AppItem>(emptyApp())
const isNew = ref(true) // true=添加模式, false=编辑模式

function emptyApp(): AppItem {
  return { id: '', name: '', command: '', url: '', width: 1200, height: 800 }
}

function selectApp(app: AppItem) {
  isNew.value = false
  editForm.value = { ...app }
}

function openAddForm() {
  isNew.value = true
  editForm.value = emptyApp()
}

// 当 apps 列表变化时同步表单（比如删除后）
watch(apps, () => {
  if (!isNew.value && editForm.value.id) {
    const still = apps.value.find(a => a.id === editForm.value.id)
    if (still) {
      editForm.value = { ...still }
    } else {
      isNew.value = true
      editForm.value = emptyApp()
    }
  }
})

// ── 数据持久化 ──
async function refreshApps() {
  apps.value = await loadApps()
}

async function persistApps() {
  await saveApps(apps.value)
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

// ── 表单操作 ──
async function saveApp() {
  if (!editForm.value.name.trim() || !editForm.value.url.trim()) {
    showMessage('请填写应用名称和目标 URL', 'error')
    return
  }
  if (!isNew.value) {
    const idx = apps.value.findIndex(a => a.id === editForm.value.id)
    if (idx !== -1) apps.value[idx] = { ...editForm.value }
  } else {
    editForm.value.id = crypto.randomUUID()
    apps.value.push({ ...editForm.value })
    isNew.value = false // 切换到编辑模式
  }
  await persistApps()
  showMessage(isNew.value ? '已保存' : '已保存', 'success')
}

async function deleteApp() {
  if (!editForm.value.id) return
  apps.value = apps.value.filter(a => a.id !== editForm.value.id)
  await persistApps()
  editForm.value = emptyApp()
  isNew.value = true
  showMessage('已删除', 'success')
}

// ── 图标颜色（单色灰调） ──
const ICON_COLORS = [
  'bg-[#f5f5f5] text-[#171717]',
  'bg-[#e8e8e8] text-[#171717]',
  'bg-[#f0f0f0] text-[#171717]',
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
    if (!filePath) return
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
    if (!filePath) return
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
  if (m === 'success') return 'bg-primary/10 text-primary'
  if (m === 'error') return 'bg-destructive/10 text-destructive'
  return 'bg-secondary text-secondary-foreground'
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

  logFailedUnlisten = await listen<{ app_id: string; reason: string }>('app-launch-failed', (e) => {
    if (e.payload.app_id === logAppId.value) {
      logLaunchFailed.value = true
      logLaunchFailedReason.value = e.payload.reason
    }
  })
}

function closeLogDialog() {
  showLogDialog.value = false
  if (logUnlisten) { logUnlisten(); logUnlisten = null }
  if (logFailedUnlisten) { logFailedUnlisten(); logFailedUnlisten = null }
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
    if (value) { await autostartEnable(); autostartEnabled.value = true }
    else { await autostartDisable(); autostartEnabled.value = false }
  } catch (e: any) {
    showMessage(`设置自启动失败: ${e}`, 'error')
  }
}

function closeSettingsDialog() {
  showSettingsDialog.value = false
}
</script>

<template>
  <div class="h-screen flex bg-background text-foreground font-sans">
    <!-- 消息 Toast -->
    <div v-if="message" :class="['fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md text-sm shadow-[var(--shadow-card)]', messageClass]">
      {{ message }}
    </div>

    <!-- ═══ 左侧栏：应用列表 ═══ -->
    <div class="w-56 shrink-0 flex flex-col border-r border-border">
      <div class="flex-1 overflow-y-auto py-2">
        <button
          v-for="app in apps"
          :key="app.id"
          class="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors cursor-pointer"
          :class="editForm.id === app.id && !isNew ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'"
          @click="selectApp(app)"
        >
          <div class="relative shrink-0">
            <div
              class="w-7 h-7 rounded-md flex items-center justify-center text-xs font-medium"
              :class="iconGradient(app.name)"
            >
              {{ app.name.charAt(0).toUpperCase() }}
            </div>
            <div
              v-if="runningAppIds.has(app.id)"
              class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500"
            />
          </div>
          <span class="text-sm truncate">{{ app.name }}</span>
        </button>

        <!-- 添加按钮 -->
        <button
          class="w-full flex items-center gap-2.5 px-4 py-2 transition-colors cursor-pointer"
          :class="isNew ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'"
          @click="openAddForm"
        >
          <div class="w-7 h-7 rounded-md flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </div>
          <span class="text-sm">添加应用</span>
        </button>
      </div>

      <!-- 底部设置 -->
      <div class="border-t border-border p-2">
        <button
          class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          @click="openSettingsDialog"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          <span class="text-xs">设置</span>
        </button>
      </div>
    </div>

    <!-- ═══ 右侧：编辑表单 ═══ -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-md mx-auto py-12 px-6 space-y-6">
        <!-- 图标 + 标题 -->
        <div class="flex items-center gap-4">
          <div
            v-if="!isNew && editForm.name"
            class="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center text-lg font-semibold"
            :class="iconGradient(editForm.name)"
          >
            {{ editForm.name.charAt(0).toUpperCase() }}
          </div>
          <div v-else class="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center bg-secondary text-muted-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-semibold tracking-[-0.32px]">
              {{ isNew ? '添加应用' : editForm.name || '未命名' }}
            </h2>
            <div v-if="!isNew && runningAppIds.has(editForm.id)" class="flex items-center gap-1.5 mt-0.5">
              <div class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span class="text-xs text-muted-foreground">运行中</span>
            </div>
          </div>
        </div>

        <!-- 表单 -->
        <div class="space-y-4">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">应用名称</label>
            <Input v-model="editForm.name" placeholder="例如：我的博客" />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">启动命令 <span class="font-normal opacity-40">(可选)</span></label>
            <Input v-model="editForm.command" placeholder="cd ~/my-app && npm run dev" />
            <p class="text-xs text-muted-foreground/60">支持 cd、&&、管道等完整 shell 语法</p>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">目标 URL</label>
            <Input v-model="editForm.url" placeholder="http://localhost:3000" />
          </div>
          <div class="flex gap-4">
            <div class="flex-1 space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">宽度</label>
              <Input v-model.number="editForm.width" type="number" />
            </div>
            <div class="flex-1 space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">高度</label>
              <Input v-model.number="editForm.height" type="number" />
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-2 pt-2">
          <Button size="sm" @click="saveApp">{{ isNew ? '添加' : '保存' }}</Button>
          <Button
            v-if="!isNew"
            size="sm"
            @click="launchApp(editForm)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
            启动
          </Button>
          <Button
            v-if="!isNew && runningAppIds.has(editForm.id) && editForm.command"
            variant="secondary"
            size="sm"
            @click="openLogDialog(editForm)"
          >
            日志
          </Button>
          <div class="flex-1" />
          <Button v-if="!isNew" variant="destructive" size="sm" @click="deleteApp">删除</Button>
        </div>
      </div>
    </div>

    <!-- ═══ 日志查看器 ═══ -->
    <Teleport to="body">
      <div
        v-if="showLogDialog"
        class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        @click.self="closeLogDialog"
      >
        <div class="bg-card rounded-lg p-6 w-full max-w-2xl max-h-[80vh] flex flex-col" style="box-shadow: var(--shadow-card)">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold tracking-[-0.32px]">{{ logAppName }} — 日志</h2>
            <div v-if="!logLaunchFailed && runningAppIds.has(logAppId)" class="flex items-center gap-1.5">
              <span class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span class="text-xs text-muted-foreground">启动中</span>
            </div>
            <span v-if="logLaunchFailed" class="text-xs text-destructive font-medium">
              {{ logLaunchFailedReason === 'process_exited' ? '进程已退出' : '启动超时' }}
            </span>
          </div>
          <div
            ref="logContainer"
            class="flex-1 overflow-y-auto bg-background rounded-md p-4 font-mono text-xs min-h-0"
            style="box-shadow: inset 0 0 0 1px var(--border)"
          >
            <div v-for="(line, i) in logLines" :key="i" class="whitespace-pre-wrap break-all text-foreground/80 hover:text-foreground">{{ line }}</div>
            <div v-if="logLines.length === 0" class="text-muted-foreground text-center py-10">暂无日志</div>
          </div>
          <div class="flex justify-end gap-2 mt-4">
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
        class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        @click.self="closeSettingsDialog"
      >
        <div class="bg-card rounded-lg p-6 w-full max-w-sm space-y-5" style="box-shadow: var(--shadow-card)">
          <h2 class="text-base font-semibold tracking-[-0.32px]">设置</h2>

          <div class="space-y-1">
            <div class="flex items-center justify-between py-3">
              <div>
                <div class="text-sm font-medium">开机自启动</div>
                <div class="text-xs text-muted-foreground mt-0.5">登录时自动启动应用</div>
              </div>
              <Switch :model-value="autostartEnabled" @update:model-value="toggleAutostart" />
            </div>

            <div style="box-shadow: 0 -1px 0 0 var(--border)" />

            <div class="flex items-center justify-between py-3">
              <div>
                <div class="text-sm font-medium">外观主题</div>
                <div class="text-xs text-muted-foreground mt-0.5">{{ themeLabel }}</div>
              </div>
              <Button variant="ghost" size="sm" @click="toggleTheme" class="text-sm px-2">{{ themeIcon }}</Button>
            </div>

            <div style="box-shadow: 0 -1px 0 0 var(--border)" />

            <div class="flex items-center justify-between py-3">
              <div>
                <div class="text-sm font-medium">数据管理</div>
                <div class="text-xs text-muted-foreground mt-0.5">导入或导出应用配置</div>
              </div>
              <div class="flex gap-1.5">
                <Button variant="ghost" size="sm" @click="handleImport" class="text-xs">导入</Button>
                <Button variant="ghost" size="sm" @click="handleExport" class="text-xs">导出</Button>
              </div>
            </div>
          </div>

          <div class="flex justify-end pt-1">
            <Button variant="secondary" size="sm" @click="closeSettingsDialog">关闭</Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
