<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

defineProps<{
  open: boolean
  autostartEnabled: boolean
  hideDockOnClose: boolean
  logRetentionLimit: number
  checkingForUpdates: boolean
  appVersion: string
  availableUpdateVersion: string
  updateReleaseNotes: string
  updateInProgress: boolean
  updateProgressPercent: number | null
  updateProgressLabel: string
  themeIcon: 'light' | 'dark' | 'system'
  themeLabel: string
}>()

defineEmits<{
  close: []
  toggleAutostart: [enabled: boolean]
  toggleHideDockOnClose: [enabled: boolean]
  updateLogRetentionLimit: [limit: number]
  checkUpdates: []
  installUpdate: []
  toggleTheme: []
  importData: []
  exportData: []
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      @click.self="!updateInProgress && $emit('close')"
    >
      <div class="bg-card rounded-lg p-6 w-full max-w-md space-y-5" style="box-shadow: var(--shadow-card)">
        <h2 class="text-base font-semibold tracking-[-0.32px]">设置</h2>

        <div class="space-y-1">
          <div class="flex items-center justify-between py-3">
            <div>
              <div class="text-sm font-medium">开机自启动</div>
              <div class="text-xs text-muted-foreground mt-0.5">登录时自动启动应用</div>
            </div>
            <Switch aria-label="开机自启动" :model-value="autostartEnabled" @update:model-value="$emit('toggleAutostart', $event)" />
          </div>

          <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

          <div class="flex items-center justify-between py-3">
            <div>
              <div class="text-sm font-medium">菜单栏模式</div>
              <div class="text-xs text-muted-foreground mt-0.5">关闭主窗口时隐藏 Dock 图标</div>
            </div>
            <Switch aria-label="菜单栏模式" :model-value="hideDockOnClose" @update:model-value="$emit('toggleHideDockOnClose', $event)" />
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
              :model-value="logRetentionLimit"
              aria-label="日志保留数量"
              @update:model-value="$emit('updateLogRetentionLimit', Number($event))"
            />
          </div>

          <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

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
              @click="$emit('toggleTheme')"
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

          <div class="h-px shadow-[0_-1px_0_0_var(--border)]" />

          <div class="space-y-3 py-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="text-sm font-medium">软件更新</div>
                <div class="text-xs text-muted-foreground mt-0.5">
                  <span>检查 GitHub Release 新版本</span>
                  <span v-if="appVersion" class="ml-2 font-mono tabular-nums">当前版本 v{{ appVersion }}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="text-xs"
                :disabled="checkingForUpdates || updateInProgress"
                @click="$emit('checkUpdates')"
              >
                {{ checkingForUpdates ? '检查中' : '检查更新' }}
              </Button>
            </div>

            <div
              v-if="availableUpdateVersion || updateInProgress"
              class="rounded-md bg-muted px-3 py-3"
              style="box-shadow: var(--shadow-border)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-medium">
                    {{ updateProgressLabel || `发现新版本 v${availableUpdateVersion}` }}
                  </div>
                  <pre
                    v-if="updateReleaseNotes && !updateInProgress"
                    class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-muted-foreground"
                  >{{ updateReleaseNotes }}</pre>
                </div>
                <Button
                  v-if="!updateInProgress"
                  variant="default"
                  size="sm"
                  class="shrink-0 text-xs"
                  @click="$emit('installUpdate')"
                >
                  下载并安装
                </Button>
              </div>

              <div v-if="updateInProgress" class="mt-3 space-y-1.5">
                <div
                  class="h-1.5 overflow-hidden rounded-full bg-background"
                  role="progressbar"
                  :aria-valuenow="updateProgressPercent ?? undefined"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="h-full rounded-full bg-foreground transition-all duration-300"
                    :class="{ 'animate-pulse': updateProgressPercent == null }"
                    :style="{ width: `${updateProgressPercent ?? 35}%` }"
                  />
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ updateProgressLabel }}
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
              <Button variant="ghost" size="sm" class="text-xs" @click="$emit('importData')">导入</Button>
              <Button variant="ghost" size="sm" class="text-xs" @click="$emit('exportData')">导出</Button>
            </div>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          class="w-full"
          :disabled="updateInProgress"
          @click="$emit('close')"
        >
          {{ updateInProgress ? '更新中' : '关闭' }}
        </Button>
      </div>
    </div>
  </Teleport>
</template>
