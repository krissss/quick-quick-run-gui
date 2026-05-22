import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunParametersDialog from '@/components/command/RunParametersDialog.vue'
import { useAppSessionStore } from '@/stores/appSession'
import { useAppsStore } from '@/stores/apps'
import { useLauncherStore } from '@/stores/launcher'
import { useMessageStore } from '@/stores/message'
import type { AppItem, AppProfile } from '@/lib/store'
import { webApp } from '../../../fixtures/apps'
import { buttonContaining, inputByPlaceholder } from '../../../helpers/dom'

function profiledApp(): AppItem {
  return {
    ...webApp,
    command: 'pnpm dev {account= : 账号} {--headless}',
    activeProfileId: '',
    profiles: [],
  }
}

function mountDialog(app: AppItem = profiledApp(), persistProfiles = vi.fn()) {
  const sessionStore = useAppSessionStore()
  const appsStore = useAppsStore()
  sessionStore.runDialogApp = app
  sessionStore.runDialogLaunchOptions = {}
  vi.spyOn(appsStore, 'updateAppProfiles').mockImplementation(persistProfiles)

  return mount(RunParametersDialog, {
    attachTo: document.body,
  })
}

describe('RunParametersDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves a draft profile and emits a launch target with draft values', async () => {
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'profile-1',
    })
    const persistProfiles = vi.fn(async (app: AppItem, profiles: AppProfile[], activeProfileId: string) => ({
      ...app,
      profiles,
      activeProfileId,
    }))
    const wrapper = mountDialog(profiledApp(), persistProfiles)
    const showMessage = vi.spyOn(useMessageStore(), 'showMessage')
    const launchApp = vi.spyOn(useLauncherStore(), 'launchApp').mockResolvedValue()

    expect(document.querySelector('button[aria-label="关闭运行参数"]')).toBeTruthy()
    await inputByPlaceholder(wrapper, '账号').setValue('demo')
    const headlessSwitch = document.querySelector('[role="switch"]')
    expect(headlessSwitch).toBeTruthy()
    await new DOMWrapper(headlessSwitch as Element).trigger('click')
    await inputByPlaceholder(wrapper, '保存为方案名称').setValue('账号 1')
    await buttonContaining(wrapper, '保存方案', true).trigger('click')
    await flushPromises()

    expect(persistProfiles).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'web-1' }),
      [expect.objectContaining({
        id: 'profile-1',
        name: '账号 1',
        values: { account: 'demo', headless: 'true' },
      })],
      'profile-1',
    )
    expect(showMessage).toHaveBeenCalledWith('已保存运行方案', 'success')
    expect(document.body.textContent).toContain('pnpm dev demo --headless')

    await buttonContaining(wrapper, '运行', true).trigger('click')
    const launchTarget = launchApp.mock.calls[0]?.[0] as AppItem
    expect(launchTarget.activeProfileId).toBe('__run-draft__')
    expect(launchTarget.profiles.at(-1)).toMatchObject({
      values: { account: 'demo', headless: 'true' },
    })
    expect(useAppSessionStore().runDialogApp).toBeNull()
  })

  it('updates and deletes a selected profile', async () => {
    const app: AppItem = {
      ...profiledApp(),
      activeProfileId: 'profile-1',
      profiles: [
        { id: 'profile-1', name: '账号 1', values: { account: 'old', headless: 'false' } },
      ],
    }
    const persistProfiles = vi.fn(async (source: AppItem, profiles: AppProfile[], activeProfileId: string) => ({
      ...source,
      profiles,
      activeProfileId,
    }))
    const wrapper = mountDialog(app, persistProfiles)
    const showMessage = vi.spyOn(useMessageStore(), 'showMessage')

    await inputByPlaceholder(wrapper, '账号').setValue('new')
    await buttonContaining(wrapper, '更新方案', true).trigger('click')
    await flushPromises()

    expect(persistProfiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'web-1' }),
      [expect.objectContaining({ values: { account: 'new', headless: 'false' } })],
      'profile-1',
    )

    const deleteButton = document.querySelector('button[aria-label="删除当前方案"]')
    expect(deleteButton).toBeTruthy()
    await new DOMWrapper(deleteButton as Element).trigger('click')
    await flushPromises()

    expect(persistProfiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'web-1' }),
      [],
      '',
    )
    expect(showMessage).toHaveBeenLastCalledWith('已删除运行方案', 'success')
  })

  it('passes an existing delayed launch request through after parameters are selected', async () => {
    const sessionStore = useAppSessionStore()
    sessionStore.runDialogApp = profiledApp()
    sessionStore.runDialogLaunchOptions = { delaySeconds: 60 }
    const launchApp = vi.spyOn(useLauncherStore(), 'launchApp').mockResolvedValue()
    const wrapper = mount(RunParametersDialog, { attachTo: document.body })

    await inputByPlaceholder(wrapper, '账号').setValue('demo')
    await buttonContaining(wrapper, '1 分钟后运行', true).trigger('click')

    expect(launchApp.mock.calls[0]?.[0]).toMatchObject({ activeProfileId: '__run-draft__' })
    expect(launchApp.mock.calls[0]?.[1]).toEqual({ delaySeconds: 60 })
  })
})
