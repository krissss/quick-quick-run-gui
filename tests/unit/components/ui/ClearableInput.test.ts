import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ClearableInput from '@/components/ui/clearable-input/ClearableInput.vue'

describe('ClearableInput', () => {
  it('clears non-empty text values', async () => {
    const wrapper = mount(ClearableInput, {
      props: {
        modelValue: 'demo',
        'onUpdate:modelValue': (value: string | number) => wrapper.setProps({ modelValue: value }),
      },
    })

    await wrapper.get('button[aria-label="清空输入"]').trigger('click')

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('hides the clear button when empty or disabled', async () => {
    const wrapper = mount(ClearableInput, {
      props: {
        modelValue: '',
      },
    })

    expect(wrapper.find('button[aria-label="清空输入"]').exists()).toBe(false)

    await wrapper.setProps({ modelValue: 'demo', disabled: true })

    expect(wrapper.find('button[aria-label="清空输入"]').exists()).toBe(false)
  })

  it('forwards native input attributes to the inner input', () => {
    const wrapper = mount(ClearableInput, {
      props: {
        modelValue: 'demo',
      },
      attrs: {
        'aria-label': '项目名称',
        autocomplete: 'off',
      },
    })

    const input = wrapper.get('input')
    expect(input.attributes('aria-label')).toBe('项目名称')
    expect(input.attributes('autocomplete')).toBe('off')
  })

  it('does not bubble clear clicks to parent containers', async () => {
    const wrapper = mount({
      components: { ClearableInput },
      data: () => ({
        value: 'demo',
        parentClicks: 0,
      }),
      template: `
        <div @click="parentClicks += 1">
          <ClearableInput v-model="value" />
        </div>
      `,
    })

    await wrapper.get('button[aria-label="清空输入"]').trigger('click')

    expect(wrapper.vm.parentClicks).toBe(0)
    expect(wrapper.vm.value).toBe('')
  })
})
