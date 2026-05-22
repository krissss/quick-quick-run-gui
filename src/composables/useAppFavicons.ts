import { onUnmounted, ref, watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { AppItem } from '@/lib/store'

export function useAppFavicons(
  apps: Readonly<Ref<AppItem[]>>,
  runningAppIds: Readonly<Ref<ReadonlySet<string>>>,
) {
  const faviconUrls = ref<Map<string, string>>(new Map())
  const faviconFailures = ref<Set<string>>(new Set())
  const faviconRequests = new Set<string>()
  const faviconRetryTimers = new Map<string, ReturnType<typeof setTimeout>[]>()

  function faviconKey(app: AppItem) {
    return `${app.id}:${app.url}`
  }

  function faviconUrl(app: AppItem) {
    return faviconUrls.value.get(faviconKey(app)) || ''
  }

  function fallbackFaviconUrl(app: AppItem) {
    try {
      return `${new URL(app.url).origin}/favicon.ico`
    } catch {
      return ''
    }
  }

  function clearFaviconRetryTimers(key: string) {
    for (const timer of faviconRetryTimers.get(key) || []) {
      window.clearTimeout(timer)
    }
    faviconRetryTimers.delete(key)
  }

  function setFaviconUrl(key: string, url: string) {
    const nextUrls = new Map(faviconUrls.value)
    nextUrls.set(key, url)
    faviconUrls.value = nextUrls
    clearFaviconRetryTimers(key)

    const nextFailures = new Set(faviconFailures.value)
    nextFailures.delete(key)
    faviconFailures.value = nextFailures
  }

  function setFaviconFailure(key: string) {
    const nextUrls = new Map(faviconUrls.value)
    nextUrls.delete(key)
    faviconUrls.value = nextUrls

    const nextFailures = new Set(faviconFailures.value)
    nextFailures.add(key)
    faviconFailures.value = nextFailures
  }

  function clearFaviconFailure(key: string) {
    if (!faviconFailures.value.has(key)) return
    const nextFailures = new Set(faviconFailures.value)
    nextFailures.delete(key)
    faviconFailures.value = nextFailures
  }

  async function loadWebFavicon(app: AppItem, force = false) {
    if (app.type !== 'web' || !app.url) return
    const key = faviconKey(app)
    if (faviconRequests.has(key)) return
    if (!force && (faviconUrls.value.has(key) || faviconFailures.value.has(key))) return

    faviconRequests.add(key)
    try {
      const iconUrl = await invoke<string | null>('get_web_favicon', { url: app.url })
      const nextUrl = iconUrl || fallbackFaviconUrl(app)
      if (nextUrl) setFaviconUrl(key, nextUrl)
      else setFaviconFailure(key)
    } catch {
      const fallback = fallbackFaviconUrl(app)
      if (fallback) setFaviconUrl(key, fallback)
      else setFaviconFailure(key)
    } finally {
      faviconRequests.delete(key)
    }
  }

  function markFaviconFailed(app: AppItem) {
    setFaviconFailure(faviconKey(app))
  }

  function retryWebFavicon(app: AppItem) {
    const key = faviconKey(app)
    if (faviconUrls.value.has(key)) return
    clearFaviconFailure(key)
    void loadWebFavicon(app, true)
  }

  function scheduleWebFaviconRetry(app: AppItem) {
    if (app.type !== 'web' || !app.url) return
    const key = faviconKey(app)
    if (!runningAppIds.value.has(app.id)) {
      clearFaviconRetryTimers(key)
      return
    }
    if (faviconUrls.value.has(key)) return
    clearFaviconRetryTimers(key)
    retryWebFavicon(app)

    const timers = [1000, 3000, 7000, 15000].map(delay =>
      window.setTimeout(() => {
        retryWebFavicon(app)
      }, delay),
    )
    faviconRetryTimers.set(key, timers)
  }

  watch(
    () => apps.value.map(app => `${app.id}:${app.type}:${app.url}`).join('|'),
    () => {
      for (const app of apps.value) {
        void loadWebFavicon(app)
      }
    },
    { immediate: true },
  )

  watch(
    () => apps.value.map(app => `${app.id}:${app.url}:${runningAppIds.value.has(app.id) ? '1' : '0'}`).join('|'),
    () => {
      for (const app of apps.value) {
        scheduleWebFaviconRetry(app)
      }
    },
  )

  onUnmounted(() => {
    for (const key of faviconRetryTimers.keys()) clearFaviconRetryTimers(key)
  })

  return {
    faviconUrl,
    markFaviconFailed,
  }
}
