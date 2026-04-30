import { onUnmounted, ref } from 'vue'

export type MessageType = 'success' | 'error' | 'info'

export interface MessageItem {
  id: number
  text: string
  type: MessageType
}

export function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useMessage() {
  const messages = ref<MessageItem[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let nextId = 0

  function dismissMessage(id: number) {
    messages.value = messages.value.filter((item) => item.id !== id)
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  function showMessage(msg: string, type: MessageType = 'info') {
    const item = { id: ++nextId, text: msg, type }
    const nextMessages = [...messages.value, item]
    const overflow = nextMessages.slice(0, Math.max(0, nextMessages.length - 4))
    overflow.forEach((oldItem) => dismissMessage(oldItem.id))
    messages.value = nextMessages.slice(-4)

    const duration = type === 'error' ? 8000 : 3500
    timers.set(item.id, setTimeout(() => dismissMessage(item.id), duration))
  }

  onUnmounted(() => {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
  })

  return { messages, showMessage, dismissMessage }
}
