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
  dialogSavePath?: string | null
  dialogOpenPath?: string | null
  files?: Record<string, string>
  autostartEnabled?: boolean
  launchResult?: { message: string; pid: number | null; run_id: string | null }
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
  let autostartEnabled = options.autostartEnabled ?? false

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

    if (cmd === 'plugin:dialog|save') return options.dialogSavePath ?? null
    if (cmd === 'plugin:dialog|open') return options.dialogOpenPath ?? null
    if (cmd === 'plugin:fs|read_text_file') {
      return Array.from(new TextEncoder().encode(files[String(args.path)] ?? ''))
    }
    if (cmd === 'plugin:fs|write_file' || cmd === 'plugin:fs|write_text_file') return null

    if (cmd === 'notify_apps_updated') return null
    if (cmd === 'get_running_apps') return clone(options.runningApps ?? [])
    if (cmd === 'get_recent_runs') return clone(options.recentRuns ?? [])
    if (cmd === 'get_app_logs') return clone(options.logs?.[String(args.appId)] ?? [])
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
    getCalls: (cmd: string) => calls.filter((call) => call.cmd === cmd),
  }
}
