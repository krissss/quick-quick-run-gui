import { ref, watch, onScopeDispose, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { formatLogLine } from '@/lib/time'

export function useLogPreview(
  appId: Ref<string>,
  isRunning: Ref<boolean>,
  hasCommand: Ref<boolean>,
) {
  const previewLines = ref<string[]>([])

  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    previewLines.value = []
  }

  async function poll() {
    try {
      const all = await invoke<string[]>('get_app_logs', { appId: appId.value })
      const last5 = all.slice(-5)
      previewLines.value = last5.map(formatLogLine)
    } catch {
      previewLines.value = []
    }
  }

  watch(
    [isRunning, hasCommand],
    ([running, hasCmd]) => {
      stop()
      if (running && hasCmd) {
        poll()
        timer = setInterval(poll, 1500)
      }
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { previewLines }
}
