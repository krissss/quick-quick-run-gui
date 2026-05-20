import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Input from '@/components/ui/input/Input.vue'

describe('Input', () => {
  it('shows a clear button for non-empty values and clears the model', async () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: 'demo',
        'onUpdate:modelValue': (value: string | number) => wrapper.setProps({ modelValue: value }),
      },
    })

    const clearButton = wrapper.get('button[aria-label="清空输入"]')
    expect(clearButton.exists()).toBe(true)

    await clearButton.trigger('click')

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('hides the clear button for empty and disabled inputs', async () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: '',
      },
    })

    expect(wrapper.find('button[aria-label="清空输入"]').exists()).toBe(false)

    await wrapper.setProps({ modelValue: 'demo', disabled: true })

    expect(wrapper.find('button[aria-label="清空输入"]').exists()).toBe(false)
  })
})
