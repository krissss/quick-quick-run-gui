import { describe, expect, it } from 'vitest'
import {
  buildCommandWithProfile,
  exportData,
  importData,
  loadApps,
  loadHideDockOnClose,
  normalizeApp,
  normalizeApps,
  parseCommandSignature,
  resolveAppProfile,
  saveApps,
  saveHideDockOnClose,
} from '@/lib/store'
import { setupTauriMocks } from '../helpers/tauri'

describe('store helpers', () => {
  it('normalizes legacy app records loaded from the store', async () => {
    setupTauriMocks({
      store: {
        apps: [
          {
            id: 'legacy-web',
            name: 'Legacy Web',
            command: '',
            url: 'http://localhost:3000',
          },
        ],
      },
    })

    const apps = await loadApps()

    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({
      id: 'legacy-web',
      name: 'Legacy Web',
      type: 'web',
      workingDirectory: '',
      profiles: [],
      activeProfileId: '',
      width: 1200,
      height: 800,
      schedule: {
        enabled: false,
        cron: '0 9 * * *',
        timezone: 'Asia/Shanghai',
        missedPolicy: 'skip',
      },
    })
  })

  it('parses command signatures and builds commands from profile values', () => {
    expect(parseCommandSignature('uv run login.py {--account= : 账号} {--headless}')).toEqual({
      baseCommand: 'uv run login.py',
      params: [
        { key: 'account', type: 'text', kind: 'option', default: '', label: '账号' },
        { key: 'headless', type: 'bool', kind: 'option', default: 'false', label: 'headless' },
      ],
    })
    expect(parseCommandSignature('echo {name= ： who}')).toEqual({
      baseCommand: 'echo',
      params: [
        { key: 'name', type: 'text', kind: 'argument', default: '', label: 'who' },
      ],
    })

    expect(buildCommandWithProfile('uv run login.py {--account= : 账号} {--headless}', {
      account: 'demo',
      headless: 'true',
    })).toBe('uv run login.py --account=demo --headless')
    expect(buildCommandWithProfile('uv run job.py {--delay=60 : 延迟} {--only=false}')).toBe('uv run job.py --delay=60')
    expect(buildCommandWithProfile('uv run job.py {--target=hanxueling:79,87 : 目标} {--enabled=true}')).toBe('uv run job.py --target=hanxueling:79,87 --enabled')
    expect(buildCommandWithProfile('echo {name= : who} {--newline=false}', { name: 'demo' })).toBe('echo demo')
    expect(buildCommandWithProfile('echo {name=world : who}')).toBe('echo world')
  })

  it('normalizes and resolves active profile parameter values', () => {
    const app = normalizeApp({
      id: 'web-1',
      name: 'Web',
      type: 'web',
      command: 'pnpm dev {account= : 账号} {--headless}',
      workingDirectory: '/repo/default',
      url: 'http://localhost:3000',
      activeProfileId: 'profile-1',
      profiles: [
        {
          id: 'profile-1',
          name: '账号 1',
          values: {
            account: 'demo',
            headless: 'true',
          },
        },
      ],
    })

    expect(resolveAppProfile(app)).toMatchObject({
      command: 'pnpm dev demo --headless',
      workingDirectory: '/repo/default',
      url: 'http://localhost:3000',
    })
  })

  it('loads and persists the menu bar mode preference', async () => {
    const mock = setupTauriMocks({
      store: { hide_dock_on_close: true },
    })

    await expect(loadHideDockOnClose()).resolves.toBe(true)

    await saveHideDockOnClose(false)

    expect(mock.storeData.hide_dock_on_close).toBe(false)
    expect(mock.getCalls('plugin:store|save')).toHaveLength(1)
  })

  it('sorts loaded apps by order and saves the current array order', async () => {
    const mock = setupTauriMocks({
      store: {
        apps: [
          { id: 'second', name: 'Second', url: 'http://localhost:3002', order: 1 },
          { id: 'first', name: 'First', url: 'http://localhost:3001', order: 0 },
        ],
      },
    })

    const loaded = await loadApps()
    expect(loaded.map((app) => app.id)).toEqual(['first', 'second'])
    expect(loaded.map((app) => app.order)).toEqual([0, 1])

    await saveApps([loaded[1], loaded[0]])

    expect(mock.storeData.apps).toMatchObject([
      { id: 'second', order: 0 },
      { id: 'first', order: 1 },
    ])
  })

  it('migrates legacy localStorage data when the store has no apps', async () => {
    const legacy = [{ id: 'legacy-local', name: 'Local', url: 'http://localhost:5173' }]
    localStorage.setItem('qqr-apps', JSON.stringify(legacy))
    const mock = setupTauriMocks()

    const apps = await loadApps()

    expect(apps[0]).toMatchObject({ id: 'legacy-local', type: 'web' })
    expect(mock.storeData.apps).toMatchObject([{ id: 'legacy-local', type: 'web' }])
    expect(localStorage.getItem('qqr-apps')).toBeNull()
  })

  it('ignores malformed localStorage migration data', async () => {
    localStorage.setItem('qqr-apps', '{bad json')
    setupTauriMocks()

    await expect(loadApps()).resolves.toEqual([])
  })

  it('saves, exports, and imports normalized app data', async () => {
    const mock = setupTauriMocks()
    const app = normalizeApp({
      id: 'service-1',
      name: 'Worker',
      type: 'service',
      command: 'pnpm worker',
      schedule: { enabled: true, cron: '*/5 * * * *', timezone: 'UTC', missedPolicy: 'run-once' },
    })

    await saveApps([app])
    expect(mock.storeData.apps).toMatchObject([{ id: 'service-1', type: 'service' }])

    await expect(exportData()).resolves.toContain('"service-1"')

    const imported = await importData(JSON.stringify([{ id: 'task-1', name: 'Task', type: 'task', command: 'echo ok' }]))
    expect(imported[0]).toMatchObject({ id: 'task-1', type: 'task', command: 'echo ok', workingDirectory: '' })
    expect(mock.storeData.apps).toMatchObject([{ id: 'task-1', type: 'task', workingDirectory: '' }])
  })

  it('normalizes app arrays with stable contiguous order values', () => {
    expect(normalizeApps([
      { id: 'third', name: 'Third', url: 'http://localhost:3003', order: 10 },
      { id: 'first', name: 'First', url: 'http://localhost:3001', order: 2 },
      { id: 'second', name: 'Second', url: 'http://localhost:3002' },
    ])).toMatchObject([
      { id: 'first', order: 0 },
      { id: 'second', order: 1 },
      { id: 'third', order: 2 },
    ])
  })

  it('rejects invalid imported data', async () => {
    setupTauriMocks()

    await expect(importData('{}')).rejects.toThrow('数据格式错误')
  })
})
