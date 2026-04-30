<script setup lang="ts">
import { onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import CronSchedulePicker from '@/components/CronSchedulePicker.vue'
import { useMessage } from '@/composables/useMessage'
import { useApps } from '@/composables/useApps'
import { useLauncher } from '@/composables/useLauncher'
import { useLogs } from '@/composables/useLogs'
import { useSettings } from '@/composables/useSettings'
import type { AppItem, AppType, MissedPolicy } from '@/lib/store'

// ── 消息 ──
const { messages, showMessage, dismissMessage } = useMessage()

// ── 日志（需要在 launcher 之前初始化，因为 launcher 依赖它） ──
const { showLogDialog, logAppId, logAppName, logLines, logLaunchFailed, logLaunchFailedReason, logWindowOpened, openLogDialog, closeLogDialog } = useLogs()

// ── 应用管理 ──
const {
  apps, editForm, isNew,
  selectApp, openAddForm, refreshApps, saveApp, deleteApp,
  setAppType, setScheduleEnabled, setMissedPolicy, setScheduleCron,
} = useApps(showMessage)

// ── 启动器 ──
const { runningAppIds, runningPids, latestRuns, refreshRunningApps, launchApp, stopApp, showAppWindow } = useLauncher(apps, showMessage, openLogDialog)

// ── 设置 ──
const { showSettingsDialog, autostartEnabled, themeIcon, themeLabel, toggleTheme, openSettingsDialog, toggleAutostart, closeSettingsDialog, handleExport, handleImport } = useSettings(apps, showMessage)

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

function itemTypeLabel(type: AppType) {
  if (type === 'task') return '任务'
  if (type === 'service') return '服务'
  return '网页'
}

function runStatusLabel(app: AppItem) {
  if (runningAppIds.value.has(app.id)) return '运行中'
  const run = latestRuns.value.get(app.id)
  if (!run) return ''
  if (run.status === 'success') return '上次成功'
  if (run.status === 'failed') return '上次失败'
  if (run.status === 'killed') return '已停止'
  if (run.status === 'lost') return '状态丢失'
  return '运行中'
}

function runStatusClass(app: AppItem) {
  if (runningAppIds.value.has(app.id)) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  const status = latestRuns.value.get(app.id)?.status
  if (status === 'success') return 'bg-secondary text-foreground'
  if (status === 'failed' || status === 'lost') return 'bg-destructive/10 text-destructive'
  return 'bg-secondary text-muted-foreground'
}

function statusDotClass(app: AppItem) {
  if (runningAppIds.value.has(app.id)) return 'bg-emerald-500'
  const status = latestRuns.value.get(app.id)?.status
  if (status === 'failed' || status === 'lost') return 'bg-destructive'
  return 'bg-muted-foreground'
}

function primaryActionLabel(app: AppItem) {
  if (app.type === 'task') return '运行'
  return '启动'
}

function schedulePolicyLabel(value: MissedPolicy) {
  return value === 'run-once' ? '补跑一次' : '跳过'
}

// ── 初始化 ──
onMounted(async () => {
  await refreshApps()
  refreshRunningApps()
})
</script>

<template>
  <div class="h-screen flex bg-background text-foreground font-sans">
    <!-- 消息 Toast -->
    <div class="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      <div
        v-for="item in messages"
        :key="item.id"
        class="pointer-events-auto flex items-start gap-2.5 rounded-lg bg-card px-3 py-2.5 text-card-foreground"
        style="box-shadow: var(--shadow-card)"
        :role="item.type === 'error' ? 'alert' : 'status'"
      >
        <div
          class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
          :class="item.type === 'error' ? 'bg-destructive/10 text-destructive' : item.type === 'success' ? 'bg-secondary text-foreground' : 'bg-secondary text-muted-foreground'"
        >
          <svg
            v-if="item.type === 'success'"
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <svg
            v-else-if="item.type === 'error'"
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </div>
        <p class="min-w-0 flex-1 break-words text-sm leading-5 text-foreground">
          {{ item.text }}
        </p>
        <button
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          type="button"
          title="关闭通知"
          aria-label="关闭通知"
          @click="dismissMessage(item.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
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
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">{{ app.name }}</div>
            <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{{ itemTypeLabel(app.type) }}</span>
              <span v-if="runStatusLabel(app)" class="inline-flex items-center gap-1">
                <span class="h-1 w-1 rounded-full" :class="statusDotClass(app)" />
                {{ runStatusLabel(app) }}
              </span>
            </div>
          </div>
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
            <div v-if="!isNew" class="flex flex-wrap items-center gap-2 mt-1">
              <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" :class="runStatusClass(editForm)">
                <span class="w-1.5 h-1.5 rounded-full" :class="statusDotClass(editForm)" />
                {{ runStatusLabel(editForm) || itemTypeLabel(editForm.type) }}
              </span>
              <span v-if="runningPids.has(editForm.id)" class="text-[11px] text-muted-foreground font-mono">PID {{ runningPids.get(editForm.id) }}</span>
              <button v-if="editForm.type === 'web' && runningAppIds.has(editForm.id)" class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-foreground transition-colors cursor-pointer" @click="showAppWindow(editForm.id)">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
                窗口
              </button>
              <button v-if="editForm.command" class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-foreground transition-colors cursor-pointer" @click="openLogDialog(editForm, true)">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                日志
              </button>
              <button v-if="runningAppIds.has(editForm.id)" class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-destructive transition-colors cursor-pointer" @click="stopApp(editForm.id)">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
                停止
              </button>
            </div>
          </div>
        </div>

        <!-- 表单 -->
        <div class="space-y-4">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">类型</label>
            <ToggleGroup
              class="grid w-full grid-cols-3 gap-1"
              :model-value="editForm.type"
              type="single"
              @update:model-value="(value) => typeof value === 'string' && value && setAppType(value as AppType)"
            >
              <ToggleGroupItem value="web">
                网页
              </ToggleGroupItem>
              <ToggleGroupItem value="service">
                服务
              </ToggleGroupItem>
              <ToggleGroupItem value="task">
                任务
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">名称</label>
            <Input v-model="editForm.name" :placeholder="editForm.type === 'task' ? '例如：同步日报' : '例如：我的博客'" />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">
              {{ editForm.type === 'task' ? '执行命令' : '启动命令' }}
              <span v-if="editForm.type === 'web'" class="font-normal opacity-40">(可选)</span>
            </label>
            <Input v-model="editForm.command" :placeholder="editForm.type === 'task' ? 'cd ~/repo && pnpm report' : 'cd ~/my-app && npm run dev'" />
            <p class="text-xs text-muted-foreground/60">支持 cd、&&、管道等完整 shell 语法</p>
          </div>
          <div v-if="editForm.type === 'web'" class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">目标 URL</label>
            <Input v-model="editForm.url" placeholder="http://localhost:3000" />
          </div>
          <div v-if="editForm.type === 'web'" class="flex gap-4">
            <div class="flex-1 space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">宽度</label>
              <Input v-model.number="editForm.width" type="number" />
            </div>
            <div class="flex-1 space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">高度</label>
              <Input v-model.number="editForm.height" type="number" />
            </div>
          </div>
          <div v-if="editForm.type === 'task'" class="space-y-3 rounded-lg bg-card p-3" style="box-shadow: var(--shadow-border)">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-medium">定时执行</div>
                <div class="text-xs text-muted-foreground mt-0.5">运行期间按 cron 触发</div>
              </div>
              <Switch :model-value="editForm.schedule.enabled" @update:model-value="setScheduleEnabled" />
            </div>
            <div v-if="editForm.schedule.enabled" class="space-y-3">
              <CronSchedulePicker
                :model-value="editForm.schedule.cron"
                @update:model-value="setScheduleCron"
              />
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">错过执行</label>
                <ToggleGroup
                  class="grid w-full grid-cols-2 gap-1"
                  :model-value="editForm.schedule.missedPolicy"
                  type="single"
                  aria-label="错过执行方式"
                  @update:model-value="(value) => typeof value === 'string' && value && setMissedPolicy(value as MissedPolicy)"
                >
                  <ToggleGroupItem value="skip">
                    {{ schedulePolicyLabel('skip') }}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="run-once">
                    {{ schedulePolicyLabel('run-once') }}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
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
            {{ primaryActionLabel(editForm) }}
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
            <div v-if="!logLaunchFailed && !logWindowOpened && runningAppIds.has(logAppId)" class="flex items-center gap-1.5">
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
              <Button
                variant="ghost"
                size="sm"
                class="h-8 w-8 px-0"
                :title="`切换主题：${themeLabel}`"
                aria-label="切换主题"
                @click="toggleTheme"
              >
                <svg
                  v-if="themeIcon === 'light'"
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
                <svg
                  v-else-if="themeIcon === 'dark'"
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8" />
                  <path d="M12 17v4" />
                </svg>
              </Button>
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
