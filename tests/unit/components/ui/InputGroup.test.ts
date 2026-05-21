import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

describe('InputGroup', () => {
  it('composes an input with an inline action button', async () => {
    const wrapper = mount({
      components: {
        InputGroup,
        InputGroupAddon,
        InputGroupButton,
        InputGroupInput,
      },
      data: () => ({
        value: 'demo',
      }),
      template: `
        <InputGroup>
          <InputGroupInput v-model="value" placeholder="Search..." />
          <InputGroupAddon v-if="value" align="inline-end">
            <InputGroupButton aria-label="Clear" @click="value = ''">x</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      `,
    })

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('demo')

    await wrapper.get('button[aria-label="Clear"]').trigger('click')

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false)
  })
})
