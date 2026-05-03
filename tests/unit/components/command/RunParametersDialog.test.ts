import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunParametersDialog from '@/components/command/RunParametersDialog.vue'
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
  return mount(RunParametersDialog, {
    attachTo: document.body,
    props: {
      open: true,
      app,
      persistProfiles,
    },
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
    expect(wrapper.emitted('message')).toEqual([['已保存运行方案', 'success']])
    expect(document.body.textContent).toContain('pnpm dev demo --headless')

    await buttonContaining(wrapper, '运行', true).trigger('click')
    const launchApp = wrapper.emitted('launch')?.[0]?.[0] as AppItem
    expect(launchApp.activeProfileId).toBe('__run-draft__')
    expect(launchApp.profiles.at(-1)).toMatchObject({
      values: { account: 'demo', headless: 'true' },
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
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
    expect(wrapper.emitted('message')?.at(-1)).toEqual(['已删除运行方案', 'success'])
  })
})
