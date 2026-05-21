import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Input from '@/components/ui/input/Input.vue'

describe('Input', () => {
  it('renders a plain input and updates the model', async () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: 'demo',
        'onUpdate:modelValue': (value: string | number) => wrapper.setProps({ modelValue: value }),
      },
    })

    expect(wrapper.find('button[aria-label="清空输入"]').exists()).toBe(false)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('demo')

    await wrapper.get('input').setValue('updated')

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('updated')
  })

  it('forwards native input attributes', () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: '12',
        type: 'number',
      },
      attrs: {
        min: '1',
        max: '99',
        'aria-label': '数量',
      },
    })

    const input = wrapper.get('input')
    expect(input.attributes('type')).toBe('number')
    expect(input.attributes('min')).toBe('1')
    expect(input.attributes('max')).toBe('99')
    expect(input.attributes('aria-label')).toBe('数量')
  })
})
