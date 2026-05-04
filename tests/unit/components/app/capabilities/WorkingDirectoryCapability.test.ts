import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkingDirectoryCapability from '@/components/app/capabilities/WorkingDirectoryCapability.vue'
import { serviceApp } from '../../../../fixtures/apps'

describe('WorkingDirectoryCapability', () => {
  it('updates the directory value and emits choose', async () => {
    const app = { ...serviceApp, schedule: { ...serviceApp.schedule }, workingDirectory: '/tmp/project' }
    const wrapper = mount(WorkingDirectoryCapability, {
      attachTo: document.body,
      props: {
        modelValue: app,
      },
    })

    await wrapper.get('input').setValue('/Users/kriss/app')
    await wrapper.get('button[aria-label="选择工作目录"]').trigger('click')

    expect(app.workingDirectory).toBe('/Users/kriss/app')
    expect(wrapper.emitted('chooseWorkingDirectory')).toHaveLength(1)
  })
})
