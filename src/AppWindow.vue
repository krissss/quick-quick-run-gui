<script setup lang="ts">
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const params = new URLSearchParams(window.location.search)
const targetUrl = params.get('url') || ''
const appId = params.get('appId') || ''

const stopping = ref(false)
const iframeLoading = ref(true)
const iframeError = ref(false)

function onIframeLoad() {
  iframeLoading.value = false
  iframeError.value = false
}

function onIframeError() {
  iframeLoading.value = false
  iframeError.value = true
}

function retry() {
  iframeError.value = false
  iframeLoading.value = true
  // 强制 iframe 重新加载
  const iframe = document.querySelector('iframe')
  if (iframe) {
    iframe.src = ''
    setTimeout(() => { iframe.src = targetUrl }, 100)
  }
}

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

    <!-- Loading 遮罩 -->
    <div v-if="iframeLoading" class="flex-1 flex items-center justify-center bg-background">
      <div class="flex flex-col items-center gap-3">
        <span class="inline-block w-6 h-6 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
        <span class="text-xs text-muted-foreground">加载中...</span>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-if="iframeError" class="flex-1 flex items-center justify-center bg-background">
      <div class="flex flex-col items-center gap-3">
        <span class="text-sm text-muted-foreground">页面加载失败</span>
        <button
          class="h-8 px-4 rounded-md text-xs font-medium bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80 transition-colors cursor-pointer"
          @click="retry"
        >
          重试
        </button>
      </div>
    </div>

    <!-- Iframe（加载中/出错时隐藏） -->
    <iframe
      v-show="!iframeLoading && !iframeError"
      :src="targetUrl"
      class="flex-1 w-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
      allowfullscreen
      @load="onIframeLoad"
      @error="onIframeError"
    />
  </div>
</template>
