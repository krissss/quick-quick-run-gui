import { nextTick } from 'vue'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { useAppsStore } from '@/stores/apps'
import { useMessageStore } from '@/stores/message'
import { setupTauriMocks } from '../helpers/tauri'

function setupStores() {
  setActivePinia(createPinia())
  const appsStore = useAppsStore()
  const messageStore = useMessageStore()
  return { appsStore, messageStore, ...storeToRefs(appsStore), ...storeToRefs(messageStore) }
}

describe('apps store', () => {
  it('validates required fields for each app type', async () => {
    setupTauriMocks()
    const { appsStore, messages } = setupStores()

    await appsStore.saveApp()
    expect(messages.value.at(-1)).toEqual({ id: 1, text: '请填写目标 URL', type: 'error' })

    appsStore.setAppType('service')
    await appsStore.saveApp()
    expect(messages.value.at(-1)?.text).toBe('请填写执行命令')

    appsStore.setAppType('task')
    appsStore.editForm.command = 'pnpm task'
    appsStore.setScheduleEnabled(true)
    appsStore.setScheduleCron('   ')
    await appsStore.saveApp()
    expect(messages.value.at(-1)?.text).toBe('请填写定时表达式')
  })

  it('defaults the app name from the command or URL when omitted', async () => {
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'default-name',
    })
    const mock = setupTauriMocks()
    const { appsStore } = setupStores()

    appsStore.setAppType('service')
    appsStore.editForm.command = 'pnpm serve'
    await appsStore.saveApp()
    expect(mock.storeData.apps).toMatchObject([
      { id: 'default-name', name: 'pnpm serve', command: 'pnpm serve' },
    ])

    appsStore.openAddForm()
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'default-url',
    })
    appsStore.editForm.url = 'http://localhost:5173'
    await appsStore.saveApp()
    expect(mock.storeData.apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'default-url', name: 'http://localhost:5173', url: 'http://localhost:5173' }),
    ]))
  })

  it('persists a valid scheduled task and notifies the backend', async () => {
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'task-1',
    })
    const mock = setupTauriMocks()
    const { appsStore, messages } = setupStores()

    appsStore.setAppType('task')
    appsStore.editForm.name = '同步日报'
    appsStore.editForm.command = 'pnpm report'
    appsStore.setScheduleEnabled(true)
    appsStore.setScheduleCron('*/30 * * * *')
    appsStore.setMissedPolicy('run-once')

    await appsStore.saveApp()

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
    expect(messages.value.at(-1)?.text).toBe('已添加')
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
    const { appsStore, apps, editForm, isNew, messages } = setupStores()

    await appsStore.refreshApps()
    expect(apps.value).toHaveLength(2)

    appsStore.selectApp(apps.value[0])
    editForm.value.name = 'Web Updated'
    await appsStore.saveApp()
    expect(mock.storeData.apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'web-1', name: 'Web Updated' }),
    ]))
    expect(messages.value.at(-1)?.text).toBe('已保存')

    apps.value = [{ ...apps.value[0], name: 'Synced Name' }, apps.value[1]]
    await nextTick()
    expect(editForm.value.name).toBe('Synced Name')

    apps.value = apps.value.filter((app) => app.id !== 'web-1')
    await nextTick()
    expect(isNew.value).toBe(true)
    expect(editForm.value.id).toBe('')

    appsStore.selectApp(apps.value[0])
    await appsStore.deleteApp()
    expect(apps.value).toEqual([])
    expect(messages.value.at(-1)?.text).toBe('已删除')

    appsStore.openAddForm()
    expect(isNew.value).toBe(true)
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
    const { appsStore, apps, editForm } = setupStores()

    await appsStore.refreshApps()
    appsStore.selectApp(apps.value[1])
    await appsStore.reorderApps('task-1', 'web-1')

    expect(apps.value.map((app) => app.id)).toEqual(['task-1', 'web-1', 'service-1'])
    expect(apps.value.map((app) => app.order)).toEqual([0, 1, 2])
    expect(editForm.value.id).toBe('service-1')
    expect(mock.storeData.apps).toMatchObject([
      { id: 'task-1', order: 0 },
      { id: 'web-1', order: 1 },
      { id: 'service-1', order: 2 },
    ])
    expect(mock.getCalls('notify_apps_updated')).toHaveLength(1)

    await appsStore.reorderApps('missing', 'web-1')
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
    const { appsStore, apps, editForm, isNew, messages } = setupStores()

    await appsStore.refreshApps()
    appsStore.selectApp(apps.value[0])
    appsStore.duplicateApp(editForm.value)

    expect(isNew.value).toBe(true)
    expect(editForm.value).toMatchObject({
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

    await appsStore.saveApp()

    expect(mock.storeData.apps).toMatchObject([
      { id: 'task-1', name: '日报' },
      { id: 'task-2', name: '日报 副本' },
      { name: '日报 副本 2', command: 'pnpm report' },
    ])
    expect(messages.value.at(-1)?.text).toBe('已添加')
  })

  it('cleans copied run profiles when saving after command template changes', async () => {
    const mock = setupTauriMocks({
      store: {
        apps: [
          {
            id: 'task-1',
            name: '同步任务',
            type: 'task',
            command: 'pnpm sync {--account= : 账号}',
            activeProfileId: 'profile-1',
            profiles: [
              {
                id: 'profile-1',
                name: '账号 1',
                values: { account: 'demo' },
              },
            ],
          },
        ],
      },
    })
    const { appsStore, apps } = setupStores()

    await appsStore.refreshApps()
    appsStore.duplicateApp(apps.value[0])
    appsStore.editForm.command = 'pnpm sync'

    await appsStore.saveApp()

    expect(mock.storeData.apps.at(-1)).toMatchObject({
      name: '同步任务 副本',
      command: 'pnpm sync',
      profiles: [],
      activeProfileId: '',
    })
  })

  it('ignores backend update notification failures while persisting', async () => {
    const mock = setupTauriMocks({
      rejectCommands: { notify_apps_updated: new Error('offline') },
    })
    const { appsStore, apps } = setupStores()
    apps.value = [{ ...apps.value[0], id: 'web-1', name: 'Web', url: 'http://localhost:3000' }]

    await expect(appsStore.persistApps()).resolves.toBeUndefined()
    expect(mock.storeData.apps).toMatchObject([{ id: 'web-1' }])
  })

  it('touches schedule metadata without changing schedule settings', () => {
    const { appsStore, editForm } = setupStores()
    appsStore.setAppType('task')
    appsStore.setScheduleCron('*/20 * * * *')
    const before = editForm.value.schedule.lastRunAt

    appsStore.touchSchedule()

    expect(editForm.value.schedule.cron).toBe('*/20 * * * *')
    expect(editForm.value.schedule.lastRunAt).toBeGreaterThanOrEqual(before ?? 0)
  })

  it('does not create records when saving an external stale selection', async () => {
    setupTauriMocks()
    const { appsStore, apps, isNew } = setupStores()
    appsStore.selectApp({ ...apps.value[0], id: 'missing', name: 'Missing', url: 'http://localhost:3000' })

    await appsStore.saveApp()

    expect(apps.value).toEqual([])
    expect(isNew.value).toBe(false)
  })
})
