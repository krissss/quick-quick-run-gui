<script setup lang="ts">
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const params = new URLSearchParams(window.location.search)
const targetUrl = params.get('url') || ''
const appId = params.get('appId') || ''

const stopping = ref(false)

async function handleStop() {
  stopping.value = true
  try {
    await invoke('stop_app_window', { appId })
  } catch (e) {
    console.error('停止失败:', e)
  }
}
</script>

<template>
  <div class="h-screen flex flex-col bg-background">
    <!-- 工具栏 -->
    <div class="h-10 shrink-0 flex items-center gap-2.5 px-3 bg-background/95 backdrop-blur-sm border-b border-border z-50">
      <span class="flex-1 text-[11px] text-muted-foreground truncate">{{ targetUrl }}</span>
      <button
        class="h-7 px-3 rounded-md text-xs font-medium bg-destructive/15 text-red-400 border border-red-500/30 hover:bg-destructive/25 transition-colors cursor-pointer disabled:opacity-50"
        @click="handleStop"
        :disabled="stopping"
      >
        {{ stopping ? '停止中...' : '停止' }}
      </button>
    </div>
    <!-- Iframe -->
    <iframe
      :src="targetUrl"
      class="flex-1 w-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      allowfullscreen
    />
  </div>
</template>
