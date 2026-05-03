import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useApps } from '@/composables/useApps'
import { setupTauriMocks } from '../helpers/tauri'

describe('useApps integration', () => {
  it('validates required fields for each app type', async () => {
    setupTauriMocks()
    const messages: Array<{ text: string; type?: string }> = []
    const apps = useApps((text, type) => messages.push({ text, type }))

    await apps.saveApp()
    expect(messages.at(-1)).toEqual({ text: '请填写目标 URL', type: 'error' })

    apps.setAppType('service')
    await apps.saveApp()
    expect(messages.at(-1)).toEqual({ text: '请填写执行命令', type: 'error' })

    apps.setAppType('task')
    apps.editForm.value.command = 'pnpm task'
    apps.setScheduleEnabled(true)
    apps.setScheduleCron('   ')
    await apps.saveApp()
    expect(messages.at(-1)).toEqual({ text: '请填写定时表达式', type: 'error' })
  })

  it('defaults the app name from the command or URL when omitted', async () => {
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'default-name',
    })
    const mock = setupTauriMocks()
    const apps = useApps(() => {})

    apps.setAppType('service')
    apps.editForm.value.command = 'pnpm serve'
    await apps.saveApp()
    expect(mock.storeData.apps).toMatchObject([
      { id: 'default-name', name: 'pnpm serve', command: 'pnpm serve' },
    ])

    apps.openAddForm()
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'default-url',
    })
    apps.editForm.value.url = 'http://localhost:5173'
    await apps.saveApp()
    expect(mock.storeData.apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'default-url', name: 'http://localhost:5173', url: 'http://localhost:5173' }),
    ]))
  })

  it('blocks saving an enabled task with an invalid cron expression', async () => {
    const mock = setupTauriMocks()
    const messages: Array<{ text: string; type?: string }> = []
    const apps = useApps((text, type) => messages.push({ text, type }))

    apps.setAppType('task')
    apps.editForm.value.name = '同步日报'
    apps.editForm.value.command = 'pnpm report'
    apps.setScheduleEnabled(true)
    apps.setScheduleCron('abc')

    await apps.saveApp()

    expect(messages.at(-1)).toEqual({ text: '定时表达式需要 5 段，例如 */15 * * * *', type: 'error' })
    expect(apps.apps.value).toEqual([])
    expect(mock.storeData.apps).toBeUndefined()
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(0)
  })

  it('persists a valid scheduled task and notifies the backend', async () => {
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'task-1',
    })
    const mock = setupTauriMocks()
    const messages: Array<{ text: string; type?: string }> = []
    const apps = useApps((text, type) => messages.push({ text, type }))

    apps.setAppType('task')
    apps.editForm.value.name = '同步日报'
    apps.editForm.value.command = 'pnpm report'
    apps.setScheduleEnabled(true)
    apps.setScheduleCron('*/30 * * * *')
    apps.setMissedPolicy('run-once')

    await apps.saveApp()

    expect(mock.storeData.apps).toMatchObject([
      {
        id: 'task-1',
        name: '同步日报',
        type: 'task',
        command: 'pnpm report',
        schedule: {
          enabled: true,
          cron: '*/30 * * * *',
          timezone: 'Asia/Shanghai',
          missedPolicy: 'run-once',
        },
      },
    ])
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)
    expect(messages.at(-1)).toEqual({ text: '已添加', type: 'success' })
  })

  it('refreshes, updates, syncs, and deletes existing app records', async () => {
    const mock = setupTauriMocks({
      store: {
        apps: [
          { id: 'web-1', name: 'Web', type: 'web', url: 'http://localhost:3000' },
          { id: 'service-1', name: 'Service', type: 'service', command: 'pnpm serve' },
        ],
      },
    })
    const messages: Array<{ text: string; type?: string }> = []
    const apps = useApps((text, type) => messages.push({ text, type }))

    await apps.refreshApps()
    expect(apps.apps.value).toHaveLength(2)

    apps.selectApp(apps.apps.value[0])
    apps.editForm.value.name = 'Web Updated'
    await apps.saveApp()
    expect(mock.storeData.apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'web-1', name: 'Web Updated' }),
    ]))
    expect(messages.at(-1)).toEqual({ text: '已保存', type: 'success' })

    apps.apps.value = [{ ...apps.apps.value[0], name: 'Synced Name' }, apps.apps.value[1]]
    await nextTick()
    expect(apps.editForm.value.name).toBe('Synced Name')

    apps.apps.value = apps.apps.value.filter((app) => app.id !== 'web-1')
    await nextTick()
    expect(apps.isNew.value).toBe(true)
    expect(apps.editForm.value.id).toBe('')

    apps.selectApp(apps.apps.value[0])
    await apps.deleteApp()
    expect(apps.apps.value).toEqual([])
    expect(messages.at(-1)).toEqual({ text: '已删除', type: 'success' })

    apps.openAddForm()
    expect(apps.isNew.value).toBe(true)
  })

  it('reorders apps, persists order values, and keeps the selected app in sync', async () => {
    const mock = setupTauriMocks({
      store: {
        apps: [
          { id: 'web-1', name: 'Web', type: 'web', url: 'http://localhost:3000', order: 0 },
          { id: 'service-1', name: 'Service', type: 'service', command: 'pnpm serve', order: 1 },
          { id: 'task-1', name: 'Task', type: 'task', command: 'pnpm task', order: 2 },
        ],
      },
    })
    const apps = useApps(() => {})

    await apps.refreshApps()
    apps.selectApp(apps.apps.value[1])
    await apps.reorderApps('task-1', 'web-1')

    expect(apps.apps.value.map((app) => app.id)).toEqual(['task-1', 'web-1', 'service-1'])
    expect(apps.apps.value.map((app) => app.order)).toEqual([0, 1, 2])
    expect(apps.editForm.value.id).toBe('service-1')
    expect(mock.storeData.apps).toMatchObject([
      { id: 'task-1', order: 0 },
      { id: 'web-1', order: 1 },
      { id: 'service-1', order: 2 },
    ])
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)

    await apps.reorderApps('missing', 'web-1')
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)
  })

  it('duplicates an app into a new template with a unique name', async () => {
    const mock = setupTauriMocks({
      store: {
        apps: [
          {
            id: 'task-1',
            name: '日报',
            type: 'task',
            command: 'pnpm report',
            schedule: { enabled: true, cron: '0 9 * * *', timezone: 'Asia/Shanghai', missedPolicy: 'skip' },
          },
          {
            id: 'task-2',
            name: '日报 副本',
            type: 'task',
            command: 'pnpm report-copy',
            schedule: { enabled: true, cron: '30 9 * * *', timezone: 'Asia/Shanghai', missedPolicy: 'run-once' },
          },
        ],
      },
    })
    const messages: Array<{ text: string; type?: string }> = []
    const apps = useApps((text, type) => messages.push({ text, type }))

    await apps.refreshApps()
    apps.selectApp(apps.apps.value[0])
    apps.duplicateApp(apps.editForm.value)

    expect(apps.isNew.value).toBe(true)
    expect(apps.editForm.value).toMatchObject({
      id: '',
      name: '日报 副本 2',
      type: 'task',
      command: 'pnpm report',
      schedule: {
        enabled: true,
        cron: '0 9 * * *',
        timezone: 'Asia/Shanghai',
        missedPolicy: 'skip',
      },
    })

    await apps.saveApp()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'task-1', name: '日报' },
      { id: 'task-2', name: '日报 副本' },
      { name: '日报 副本 2', command: 'pnpm report' },
    ])
    expect(messages.at(-1)).toEqual({ text: '已添加', type: 'success' })
  })

  it('ignores backend update notification failures while persisting', async () => {
    const mock = setupTauriMocks({
      rejectCommands: { notify_apps_updated: new Error('offline') },
    })
    const apps = useApps(() => {})
    apps.apps.value = [{ ...apps.editForm.value, id: 'web-1', name: 'Web', url: 'http://localhost:3000' }]

    await expect(apps.persistApps()).resolves.toBeUndefined()
    expect(mock.storeData.apps).toMatchObject([{ id: 'web-1' }])
  })

  it('touches schedule metadata without changing schedule settings', () => {
    const apps = useApps(() => {})
    apps.setAppType('task')
    apps.setScheduleCron('*/20 * * * *')
    const before = apps.editForm.value.schedule.lastRunAt

    apps.touchSchedule()

    expect(apps.editForm.value.schedule.cron).toBe('*/20 * * * *')
    expect(apps.editForm.value.schedule.lastRunAt).toBeGreaterThanOrEqual(before ?? 0)
  })

  it('does not create records when saving an external stale selection', async () => {
    setupTauriMocks()
    const apps = useApps(() => {})
    apps.selectApp({ ...apps.editForm.value, id: 'missing', name: 'Missing', url: 'http://localhost:3000' })

    await apps.saveApp()

    expect(apps.apps.value).toEqual([])
    expect(apps.isNew.value).toBe(false)
  })
})
