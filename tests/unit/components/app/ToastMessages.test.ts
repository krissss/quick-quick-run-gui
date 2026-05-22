import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ToastMessages from '@/components/app/ToastMessages.vue'
import { useMessageStore } from '@/stores/message'

describe('ToastMessages', () => {
  it('renders message roles and emits dismiss', async () => {
    const messageStore = useMessageStore()
    messageStore.messages = [
      { id: 1, text: '已保存', type: 'success' },
      { id: 2, text: '失败', type: 'error' },
    ]
    const dismissMessage = vi.spyOn(messageStore, 'dismissMessage')
    const wrapper = mount(ToastMessages)

    expect(wrapper.text()).toContain('已保存')
    expect(wrapper.classes()).toContain('z-[80]')
    expect(wrapper.find('[role="alert"]').text()).toContain('失败')

    await wrapper.get('button[aria-label="关闭通知"]').trigger('click')

    expect(dismissMessage).toHaveBeenCalledWith(1)
  })
})
