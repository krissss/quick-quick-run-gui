<script setup lang="ts">
import { onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useMessage } from '@/composables/useMessage'
import { useApps } from '@/composables/useApps'
import { useLauncher } from '@/composables/useLauncher'
import { useLogs } from '@/composables/useLogs'
import { useSettings } from '@/composables/useSettings'

// ── 消息 ──
const { message, messageClass, showMessage } = useMessage()

// ── 日志（需要在 launcher 之前初始化，因为 launcher 依赖它） ──
const { showLogDialog, logAppId, logAppName, logLines, logLaunchFailed, logLaunchFailedReason, openLogDialog, closeLogDialog } = useLogs()

// ── 应用管理 ──
const { apps, editForm, isNew, selectApp, openAddForm, refreshApps, saveApp, deleteApp } = useApps(showMessage)

// ── 启动器 ──
const { runningAppIds, refreshRunningApps, launchApp, stopApp, showAppWindow } = useLauncher(apps, showMessage, openLogDialog)

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

// ── 初始化 ──
onMounted(async () => {
  await refreshApps()
  refreshRunningApps()
})
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
            <div v-if="!isNew && runningAppIds.has(editForm.id)" class="flex items-center gap-2 mt-1">
              <span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                运行中
              </span>
              <button class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-foreground transition-colors cursor-pointer" @click="showAppWindow(editForm.id)">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
                窗口
              </button>
              <button v-if="editForm.command" class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-foreground transition-colors cursor-pointer" @click="openLogDialog(editForm)">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
                日志
              </button>
              <button class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-secondary hover:text-destructive transition-colors cursor-pointer" @click="stopApp(editForm.id)">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
                停止
              </button>
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
