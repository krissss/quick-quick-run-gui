import { describe, expect, it } from 'vitest'
import {
  exportData,
  importData,
  loadApps,
  loadHideDockOnClose,
  normalizeApp,
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

  it('loads and persists the menu bar mode preference', async () => {
    const mock = setupTauriMocks({
      store: { hide_dock_on_close: true },
    })

    await expect(loadHideDockOnClose()).resolves.toBe(true)

    await saveHideDockOnClose(false)

    expect(mock.storeData.hide_dock_on_close).toBe(false)
    expect(mock.getCalls('plugin:store|save')).toHaveLength(1)
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
    expect(imported[0]).toMatchObject({ id: 'task-1', type: 'task', command: 'echo ok' })
    expect(mock.storeData.apps).toMatchObject([{ id: 'task-1', type: 'task' }])
  })

  it('rejects invalid imported data', async () => {
    setupTauriMocks()

    await expect(importData('{}')).rejects.toThrow('数据格式错误')
  })
})
