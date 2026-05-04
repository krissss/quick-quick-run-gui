import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RestartCapability from '@/components/app/capabilities/RestartCapability.vue'
import RetryCapability from '@/components/app/capabilities/RetryCapability.vue'
import StartupCapability from '@/components/app/capabilities/StartupCapability.vue'
import { serviceApp, taskApp, webApp } from '../../../../fixtures/apps'
import { buttonContaining } from '../../../../helpers/dom'

describe('lifecycle capabilities', () => {
  it('emits startup changes', async () => {
    const wrapper = mount(StartupCapability, {
      attachTo: document.body,
      props: {
        modelValue: { ...webApp, startup: { ...webApp.startup }, schedule: { ...webApp.schedule } },
      },
    })

    await wrapper.get('[role="switch"]').trigger('click')

    expect(wrapper.emitted('setStartup')).toEqual([[{ ...webApp.startup, enabled: true }]])
  })

  it('emits restart policy changes', async () => {
    const wrapper = mount(RestartCapability, {
      attachTo: document.body,
      props: {
        modelValue: { ...serviceApp, restart: { ...serviceApp.restart }, schedule: { ...serviceApp.schedule } },
      },
    })

    await wrapper.get('[role="switch"]').trigger('click')
    await wrapper.setProps({ modelValue: { ...serviceApp, restart: { ...serviceApp.restart, enabled: true } } })
    await buttonContaining(wrapper, '总是', true).trigger('click')

    expect(wrapper.emitted('setRestart')?.[0]).toEqual([{ ...serviceApp.restart, enabled: true }])
    expect(wrapper.emitted('setRestart')?.[1]).toEqual([{ ...serviceApp.restart, enabled: true, mode: 'always' }])
  })

  it('emits retry changes', async () => {
    const wrapper = mount(RetryCapability, {
      attachTo: document.body,
      props: {
        modelValue: { ...taskApp, retry: { ...taskApp.retry }, schedule: { ...taskApp.schedule } },
      },
    })

    await wrapper.get('[role="switch"]').trigger('click')

    expect(wrapper.emitted('setRetry')).toEqual([[{ ...taskApp.retry, enabled: true }]])
  })
})
