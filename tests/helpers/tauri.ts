import { mockIPC } from '@tauri-apps/api/mocks'
import type { AppType } from '@/lib/store'
import type { RunRecord } from '@/composables/useLauncher'

interface RunningAppInfo {
  app_id: string
  pid: number | null
  item_type: AppType
}

interface MockOptions {
  store?: Record<string, unknown>
  runningApps?: RunningAppInfo[]
  recentRuns?: RunRecord[]
  logs?: Record<string, string[]>
  runLogs?: Record<string, string[]>
  dialogSavePath?: string | null
  dialogOpenPath?: string | null
  dialogConfirm?: boolean
  files?: Record<string, string>
  autostartEnabled?: boolean
  launchResult?: { message: string; pid: number | null; run_id: string | null }
  update?: null | { rid?: number; version: string; currentVersion?: string; date?: string; body?: string; rawJson?: Record<string, unknown> }
  updateDownloadEvents?: Array<
    | { event: 'Started'; data: { contentLength?: number } }
    | { event: 'Progress'; data: { chunkLength: number } }
    | { event: 'Finished' }
  >
  holdUpdateDownload?: boolean
  appVersion?: string
  favicons?: Record<string, string | null>
  faviconResolver?: (url: string) => string | null
  rejectCommands?: Record<string, unknown>
}

interface CommandCall {
  cmd: string
  payload: unknown
  options?: unknown
}

function clone<T>(value: T): T {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function setupTauriMocks(options: MockOptions = {}) {
  const storeData: Record<string, unknown> = clone(options.store ?? {})
  const files: Record<string, string> = clone(options.files ?? {})
  const calls: CommandCall[] = []
  let recentRuns = clone(options.recentRuns ?? [])
  let autostartEnabled = options.autostartEnabled ?? false
  let resolveUpdateDownload: ((rid: number) => void) | null = null

  mockIPC((cmd, payload = {}) => {
    const args = payload as Record<string, unknown>

    if (Object.prototype.hasOwnProperty.call(options.rejectCommands ?? {}, cmd)) {
      throw options.rejectCommands?.[cmd]
    }

    if (cmd === 'plugin:store|load') return 1
    if (cmd === 'plugin:store|get_store') return 1
    if (cmd === 'plugin:store|get') {
      const key = String(args.key)
      const exists = Object.prototype.hasOwnProperty.call(storeData, key)
      return [clone(storeData[key]), exists]
    }
    if (cmd === 'plugin:store|set') {
      storeData[String(args.key)] = clone(args.value)
      return null
    }
    if (cmd === 'plugin:store|has') {
      return Object.prototype.hasOwnProperty.call(storeData, String(args.key))
    }
    if (cmd === 'plugin:store|delete') {
      delete storeData[String(args.key)]
      return null
    }
    if (cmd === 'plugin:store|clear' || cmd === 'plugin:store|reset') {
      for (const key of Object.keys(storeData)) delete storeData[key]
      return null
    }
    if (cmd === 'plugin:store|keys') return Object.keys(storeData)
    if (cmd === 'plugin:store|values') return Object.values(storeData).map(clone)
    if (cmd === 'plugin:store|entries') return Object.entries(storeData).map(clone)
    if (cmd === 'plugin:store|length') return Object.keys(storeData).length
    if (cmd === 'plugin:store|save' || cmd === 'plugin:store|reload') return null

    if (cmd === 'plugin:autostart|is_enabled') return autostartEnabled
    if (cmd === 'plugin:autostart|enable') {
      autostartEnabled = true
      return null
    }
    if (cmd === 'plugin:autostart|disable') {
      autostartEnabled = false
      return null
    }
    if (cmd === 'plugin:app|version') return options.appVersion ?? '0.0.0-test'

    if (cmd === 'plugin:updater|check') {
      if (!options.update) return null
      return {
        rid: options.update.rid ?? 1,
        currentVersion: options.update.currentVersion ?? '0.1.0',
        version: options.update.version,
        date: options.update.date,
        body: options.update.body,
        rawJson: options.update.rawJson ?? {},
      }
    }
    if (cmd === 'plugin:updater|download_and_install') return null
    if (cmd === 'plugin:updater|download') {
      const channelId = typeof args.onEvent === 'object' && args.onEvent != null && 'id' in args.onEvent
        ? Number(args.onEvent.id)
        : Number(String(args.onEvent).replace('__CHANNEL__:', ''))
      const events = options.updateDownloadEvents ?? [
        { event: 'Started' as const, data: { contentLength: 100 } },
        { event: 'Progress' as const, data: { chunkLength: 40 } },
        { event: 'Progress' as const, data: { chunkLength: 60 } },
        { event: 'Finished' as const },
      ]
      const tauriInternals = window as unknown as {
        __TAURI_INTERNALS__?: {
          runCallback?: (id: number, data: unknown) => void
        }
      }
      events.forEach((event, index) => {
        tauriInternals.__TAURI_INTERNALS__?.runCallback?.(channelId, { index, message: event })
      })
      tauriInternals.__TAURI_INTERNALS__?.runCallback?.(channelId, { index: events.length, end: true })
      if (options.holdUpdateDownload) {
        return new Promise((resolve) => {
          resolveUpdateDownload = resolve
        })
      }
      return 1
    }
    if (cmd === 'plugin:updater|install') return null
    if (cmd === 'plugin:resources|close') return null
    if (cmd === 'plugin:process|restart') return null

    if (cmd === 'plugin:dialog|save') return options.dialogSavePath ?? null
    if (cmd === 'plugin:dialog|open') return options.dialogOpenPath ?? null
    if (cmd === 'plugin:dialog|message') {
      const buttons = args.buttons as Record<string, [string, string]> | string | undefined
      if (buttons && typeof buttons === 'object' && 'OkCancelCustom' in buttons) {
        const [okLabel, cancelLabel] = buttons.OkCancelCustom
        return options.dialogConfirm ?? true ? okLabel : cancelLabel
      }
      return 'Ok'
    }
    if (cmd === 'plugin:fs|read_text_file') {
      return Array.from(new TextEncoder().encode(files[String(args.path)] ?? ''))
    }
    if (cmd === 'plugin:fs|write_file' || cmd === 'plugin:fs|write_text_file') return null

    if (cmd === 'notify_apps_updated') return null
    if (cmd === 'get_running_apps') return clone(options.runningApps ?? [])
    if (cmd === 'get_recent_runs') return clone(recentRuns)
    if (cmd === 'get_web_favicon') {
      const url = String(args.url)
      return options.faviconResolver?.(url) ?? options.favicons?.[url] ?? null
    }
    if (cmd === 'get_app_log_runs') {
      const appId = String(args.appId)
      const limit = typeof args.limit === 'number' ? args.limit : 50
      return clone(recentRuns.filter(run => run.app_id === appId).slice(0, limit))
    }
    if (cmd === 'get_app_logs') {
      if (args.runId != null) return clone(options.runLogs?.[String(args.runId)] ?? [])
      return clone(options.logs?.[String(args.appId)] ?? [])
    }
    if (cmd === 'clear_app_logs') {
      const appId = String(args.appId)
      const runIds = Array.isArray(args.runIds) ? new Set(args.runIds.map(String)) : null
      const before = recentRuns.length
      recentRuns = recentRuns.filter((run) => {
        return run.app_id !== appId || run.status === 'running' || (runIds != null && !runIds.has(run.id))
      })
      return { removed: before - recentRuns.length }
    }
    if (cmd === 'prune_log_records') return { removed: 0 }
    if (cmd === 'launch_app_window') {
      return options.launchResult ?? { message: '已启动', pid: 1234, run_id: 'run-1' }
    }
    if (cmd === 'stop_app' || cmd === 'show_app_window' || cmd === 'open_in_browser') return null

    throw new Error(`Unhandled Tauri command: ${cmd}`)
  }, { shouldMockEvents: true })

  const tauriInternals = window as unknown as {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>
    }
  }
  const invoke = tauriInternals.__TAURI_INTERNALS__.invoke
  tauriInternals.__TAURI_INTERNALS__.invoke = async (cmd, args = {}, invokeOptions) => {
    calls.push({ cmd, payload: args, options: invokeOptions })
    return invoke(cmd, args, invokeOptions)
  }

  return {
    calls,
    files,
    storeData,
    resolveUpdateDownload: () => resolveUpdateDownload?.(1),
    getCalls: (cmd: string) => calls.filter((call) => call.cmd === cmd),
  }
}
