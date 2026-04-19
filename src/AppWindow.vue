<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const params = new URLSearchParams(window.location.search)
const targetUrl = params.get('url') || ''

const iframeLoading = ref(true)
const iframeError = ref(false)
const retryCount = ref(0)
const MAX_RETRIES = 5
const iframeRef = useTemplateRef<HTMLIFrameElement>('iframeRef')

function onIframeLoad() {
  retryCount.value = 0
  iframeLoading.value = false
  iframeError.value = false
}

function onIframeError() {
  if (retryCount.value < MAX_RETRIES) {
    retryCount.value++
    setTimeout(() => {
      if (iframeRef.value) {
        iframeRef.value.src = ''
        setTimeout(() => { if (iframeRef.value) iframeRef.value.src = targetUrl }, 100)
      }
    }, 2000 * retryCount.value)
  } else {
    iframeLoading.value = false
    iframeError.value = true
  }
}

function reload() {
  iframeError.value = false
  iframeLoading.value = true
  if (iframeRef.value) {
    iframeRef.value.src = ''
    setTimeout(() => { if (iframeRef.value) iframeRef.value.src = targetUrl }, 100)
  }
}

async function openInBrowser() {
  try {
    await invoke('open_in_browser', { url: targetUrl })
  } catch { /* ignore */ }
}
</script>

<template>
  <div class="h-screen flex flex-col bg-background font-sans">
    <!-- Loading 遮罩 -->
    <div v-if="iframeLoading" class="flex-1 flex items-center justify-center bg-background">
      <div class="flex flex-col items-center gap-3">
        <span class="inline-block w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span class="text-sm text-muted-foreground">加载中...</span>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-if="iframeError" class="flex-1 flex items-center justify-center bg-background">
      <div class="flex flex-col items-center gap-3">
        <span class="text-sm text-muted-foreground">页面加载失败</span>
        <button
          class="h-8 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
          @click="reload"
        >
          重试
        </button>
      </div>
    </div>

    <!-- iframe + 工具栏 -->
    <div class="flex-1 relative">
      <iframe
        ref="iframeRef"
        v-show="!iframeLoading && !iframeError"
        :src="targetUrl"
        class="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-top-navigation"
        allowfullscreen
        @load="onIframeLoad"
        @error="onIframeError"
      />

      <!-- 悬浮工具栏（鼠标移入顶部区域时显示） -->
      <div v-if="!iframeLoading && !iframeError" class="group absolute top-0 inset-x-0 z-10">
        <div class="flex items-center justify-center h-6 opacity-0 group-hover:opacity-100 transition-opacity">
          <div class="flex items-center gap-0.5 rounded-b-md bg-card/90 backdrop-blur-sm px-1 py-0.5" style="box-shadow: var(--shadow-card)">
            <button
              class="h-6 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              title="刷新页面"
              @click="reload"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
            </button>
            <button
              class="h-6 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              title="在浏览器中打开"
              @click="openInBrowser"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
