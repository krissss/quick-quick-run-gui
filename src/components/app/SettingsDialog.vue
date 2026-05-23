<script setup lang="ts">
import { Monitor, Moon, SunMedium } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { DialogFrame } from '@/components/ui/dialog-frame'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
</script>

<template>
  <DialogFrame
    :open="settingsStore.showSettingsDialog"
    title="设置"
    close-label="关闭设置"
    :close-disabled="settingsStore.updateInProgress"
    panel-class="max-w-md"
    @close="settingsStore.closeSettingsDialog"
  >
    <div class="space-y-1">
      <div class="flex items-center justify-between py-3">
        <div>
          <div class="text-sm font-medium">开机自启动</div>
          <div class="text-xs text-muted-foreground mt-0.5">登录时自动启动应用</div>
        </div>
        <Switch aria-label="开机自启动" :model-value="settingsStore.autostartEnabled" @update:model-value="settingsStore.toggleAutostart" />
      </div>

      <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

      <div class="flex items-center justify-between py-3">
        <div>
          <div class="text-sm font-medium">菜单栏模式</div>
          <div class="text-xs text-muted-foreground mt-0.5">关闭主窗口时隐藏 Dock 图标</div>
        </div>
        <Switch aria-label="菜单栏模式" :model-value="settingsStore.hideDockOnClose" @update:model-value="settingsStore.toggleHideDockOnClose" />
      </div>

      <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

      <div class="flex items-center justify-between gap-4 py-3">
        <div>
          <div class="text-sm font-medium">日志保留</div>
          <div class="text-xs text-muted-foreground mt-0.5">每个应用保留最近运行日志</div>
        </div>
        <Input
          class="h-8 w-24 text-right"
          type="number"
          min="1"
          max="200"
          :model-value="settingsStore.logRetentionLimit"
          aria-label="日志保留数量"
          @update:model-value="settingsStore.updateLogRetentionLimit(Number($event))"
        />
      </div>

      <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

      <div class="flex items-center justify-between gap-4 py-3">
        <div>
          <div class="text-sm font-medium">停止等待</div>
          <div class="text-xs text-muted-foreground mt-0.5">发送 Ctrl+C 后等待再强制结束</div>
        </div>
        <Input
          class="h-8 w-24 text-right"
          type="number"
          min="1"
          max="120"
          :model-value="settingsStore.gracefulStopTimeoutSeconds"
          aria-label="停止等待秒数"
          @update:model-value="settingsStore.updateGracefulStopTimeoutSeconds(Number($event))"
        />
      </div>

      <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

      <div class="flex items-center justify-between py-3">
        <div>
          <div class="text-sm font-medium">外观主题</div>
          <div class="text-xs text-muted-foreground mt-0.5">{{ settingsStore.themeLabel }}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 px-0"
          :title="`切换主题：${settingsStore.themeLabel}`"
          aria-label="切换主题"
          @click="settingsStore.toggleTheme"
        >
          <SunMedium v-if="settingsStore.themeIcon === 'light'" :size="14" :stroke-width="2" aria-hidden="true" />
          <Moon v-else-if="settingsStore.themeIcon === 'dark'" :size="14" :stroke-width="2" aria-hidden="true" />
          <Monitor v-else :size="14" :stroke-width="2" aria-hidden="true" />
        </Button>
      </div>

      <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

      <div class="space-y-3 py-3">
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-sm font-medium">软件更新</div>
            <div class="text-xs text-muted-foreground mt-0.5">
              <span>检查 GitHub Release 新版本</span>
              <span v-if="settingsStore.appVersion" class="ml-2 font-mono tabular-nums">当前版本 v{{ settingsStore.appVersion }}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="text-xs"
            :disabled="settingsStore.checkingForUpdates || settingsStore.updateInProgress"
            @click="settingsStore.checkForUpdates"
          >
            {{ settingsStore.checkingForUpdates ? '检查中' : '检查更新' }}
          </Button>
        </div>

        <div
          v-if="settingsStore.availableUpdateVersion || settingsStore.updateInProgress"
          class="rounded-md bg-muted px-3 py-3"
          style="box-shadow: var(--shadow-border)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-medium">
                {{ settingsStore.updateProgressLabel || `发现新版本 v${settingsStore.availableUpdateVersion}` }}
              </div>
              <pre
                v-if="settingsStore.updateReleaseNotes && !settingsStore.updateInProgress"
                class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-muted-foreground"
              >{{ settingsStore.updateReleaseNotes }}</pre>
            </div>
            <Button
              v-if="!settingsStore.updateInProgress"
              variant="default"
              size="sm"
              class="shrink-0 text-xs"
              @click="settingsStore.installAvailableUpdate"
            >
              下载并安装
            </Button>
          </div>

          <div v-if="settingsStore.updateInProgress" class="mt-3 space-y-1.5">
            <div
              class="h-1.5 overflow-hidden rounded-full bg-background"
              role="progressbar"
              :aria-valuenow="settingsStore.updateProgressPercent ?? undefined"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="h-full rounded-full bg-foreground transition-all duration-300"
                :class="{ 'animate-pulse': settingsStore.updateProgressPercent == null }"
                :style="{ width: `${settingsStore.updateProgressPercent ?? 35}%` }"
              />
            </div>
            <div class="text-xs text-muted-foreground">
              {{ settingsStore.updateProgressLabel }}
            </div>
          </div>
        </div>
      </div>

      <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

      <div class="flex items-center justify-between py-3">
        <div>
          <div class="text-sm font-medium">数据管理</div>
          <div class="text-xs text-muted-foreground mt-0.5">导入或导出应用配置</div>
        </div>
        <div class="flex gap-1.5">
          <Button variant="ghost" size="sm" class="text-xs" @click="settingsStore.handleImport">导入</Button>
          <Button variant="ghost" size="sm" class="text-xs" @click="settingsStore.handleExport">导出</Button>
        </div>
      </div>
    </div>

  </DialogFrame>
</template>
