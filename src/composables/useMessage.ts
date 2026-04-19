import { ref, computed } from 'vue'

export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useMessage() {
  const message = ref('')
  const messageType = ref<'success' | 'error' | 'info'>('info')

  function showMessage(msg: string, type: 'success' | 'error' | 'info' = 'info') {
    message.value = msg
    messageType.value = type
    setTimeout(() => { message.value = '' }, 5000)
  }

  const messageClass = computed(() => {
    const m = messageType.value
    if (m === 'success') return 'bg-primary/10 text-primary'
    if (m === 'error') return 'bg-destructive/10 text-destructive'
    return 'bg-secondary text-secondary-foreground'
  })

  return { message, messageType, messageClass, showMessage }
}
