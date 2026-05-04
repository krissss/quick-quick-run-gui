import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScheduleCapability from '@/components/app/capabilities/ScheduleCapability.vue'
import CronSchedulePicker from '@/components/schedule/CronSchedulePicker.vue'
import { baseSchedule, taskApp } from '../../../../fixtures/apps'
import { buttonContaining } from '../../../../helpers/dom'

describe('ScheduleCapability', () => {
  it('emits cron and missed policy changes for enabled schedules', async () => {
    const wrapper = mount(ScheduleCapability, {
      attachTo: document.body,
      props: {
        modelValue: {
          ...taskApp,
          schedule: {
            ...baseSchedule,
            enabled: true,
            missedPolicy: 'run-once',
          },
        },
      },
    })

    await wrapper.getComponent(CronSchedulePicker).vm.$emit('update:modelValue', '*/15 * * * *')
    await buttonContaining(wrapper, '跳过', true).trigger('click')

    expect(wrapper.emitted('setScheduleCron')).toEqual([['*/15 * * * *']])
    expect(wrapper.emitted('setMissedPolicy')).toEqual([['skip']])
  })

  it('emits enabled changes from the switch', async () => {
    const wrapper = mount(ScheduleCapability, {
      attachTo: document.body,
      props: {
        modelValue: {
          ...taskApp,
          schedule: {
            ...baseSchedule,
            enabled: false,
          },
        },
      },
    })

    await wrapper.get('[role="switch"]').trigger('click')

    expect(wrapper.emitted('setScheduleEnabled')).toEqual([[true]])
  })
})
