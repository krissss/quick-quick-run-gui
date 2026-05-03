import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CronSchedulePicker from '@/components/schedule/CronSchedulePicker.vue'
import { Input } from '@/components/ui/input'

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

describe('CronSchedulePicker', () => {
  it('switches to custom mode and emits typed cron text', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '0 9 * * *' },
    })

    await buttonByText(wrapper, '自定义').trigger('click')
    const input = wrapper.get('input[placeholder="*/15 * * * *"]')
    await input.setValue('30 8 * * 1-5')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['30 8 * * 1-5'])
  })

  it('clamps minute intervals to cron-safe bounds', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '*/15 * * * *' },
    })

    await wrapper.get('input[type="number"]').setValue('90')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['*/59 * * * *'])
  })

  it('parses and edits hourly schedules', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '5 * * * *' },
    })

    expect(wrapper.text()).toContain('每小时第几分钟')
    await wrapper.get('input[type="number"]').setValue('70')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['59 * * * *'])
  })

  it('parses and edits daily schedules', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '30 8 * * *' },
    })
    const inputs = wrapper.findAll('input[type="number"]')

    expect(wrapper.text()).toContain('小时')
    await inputs[0].setValue('25')
    await inputs[1].setValue('-1')

    expect(wrapper.emitted('update:modelValue')?.at(-2)).toEqual(['30 23 * * *'])
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['0 8 * * *'])
  })

  it('parses weekly schedules and normalizes Sunday', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '15 7 * * 0' },
    })

    expect(wrapper.text()).toContain('周日')
    await buttonByText(wrapper, '周三').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['15 7 * * 3'])
  })

  it('parses and edits monthly schedules', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '20 6 15 * *' },
    })
    const inputs = wrapper.findAll('input[type="number"]')

    expect(wrapper.text()).toContain('日期')
    await inputs[0].setValue('40')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['20 6 31 * *'])
  })

  it('builds standard cron expressions when switching modes', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: 'not a cron' },
    })

    await buttonByText(wrapper, '每小时').trigger('click')
    await buttonByText(wrapper, '每天').trigger('click')
    await buttonByText(wrapper, '每周').trigger('click')
    await buttonByText(wrapper, '每月').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['0 * * * *'],
      ['0 9 * * *'],
      ['0 9 * * 1'],
      ['0 9 1 * *'],
    ])
  })

  it('handles empty custom input payloads and external prop changes', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '0 9 * * *' },
    })

    await buttonByText(wrapper, '自定义').trigger('click')
    wrapper.findComponent(Input).vm.$emit('update:modelValue', undefined)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])

    await wrapper.setProps({ modelValue: '*/5 * * * *' })
    expect(wrapper.text()).toContain('间隔')
  })

  it('falls back to custom mode for unsupported five-field cron and preserves custom text on numeric edits', async () => {
    const wrapper = mount(CronSchedulePicker, {
      props: { modelValue: '1 2 3 4 5' },
    })

    expect(wrapper.text()).toContain('Cron')

    await buttonByText(wrapper, '每天').trigger('click')
    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[1].setValue('12')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['1 2 3 4 5'])
  })
})
