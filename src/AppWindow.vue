<script setup lang="ts">
import { ref } from 'vue'

const params = new URLSearchParams(window.location.search)
const targetUrl = params.get('url') || ''

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
  const iframe = document.querySelector('iframe')
  if (iframe) {
    iframe.src = ''
    setTimeout(() => { iframe.src = targetUrl }, 100)
  }
}
</script>

<template>
  <div class="h-screen flex flex-col bg-background">
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
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-top-navigation"
      allowfullscreen
      @load="onIframeLoad"
      @error="onIframeError"
    />
  </div>
</template>
