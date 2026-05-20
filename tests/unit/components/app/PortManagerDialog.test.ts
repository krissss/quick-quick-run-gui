import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PortManagerDialog from '@/components/app/PortManagerDialog.vue'
import { buttonContaining, inputByPlaceholder } from '../../../helpers/dom'
import { setupTauriMocks } from '../../../helpers/tauri'

function mountDialog(props: {
  open?: boolean
  rejectCommand?: 'inspect_port' | 'kill_port_pid'
  clearPortAfterKill?: boolean
} = {}) {
  const portProcesses = props.clearPortAfterKill
    ? {
        3815: [
          {
            pid: 123,
            command: 'node',
            full_command: 'node server.js',
            parent_pid: null,
            process_role: '独立进程',
            user: '501',
            protocol: 'TCP',
            address: '127.0.0.1:3815',
            port: 3815,
            raw: '127.0.0.1:3815',
          },
        ],
      }
    : {
        3815: [
          {
            pid: 123,
            command: 'node',
            full_command: 'node server.js',
            parent_pid: null,
            process_role: '独立进程',
            user: '501',
            protocol: 'TCP',
            address: '127.0.0.1:3815',
            port: 3815,
            raw: '127.0.0.1:3815',
          },
        ],
      }
  setupTauriMocks({
    portProcesses,
    clearPortAfterKill: props.clearPortAfterKill,
    rejectCommands: props.rejectCommand
      ? {
          [props.rejectCommand]: props.rejectCommand === 'inspect_port'
            ? 'lsof 查询失败: permission denied'
            : 'PID 123 仍在监听端口 3815',
        }
      : undefined,
  })
  return mount(PortManagerDialog, {
    attachTo: document.body,
    props: {
      open: props.open ?? true,
    },
  })
}

describe('PortManagerDialog', () => {
  it('focuses the port input when opened', async () => {
    const wrapper = mountDialog({ open: false })

    await wrapper.setProps({ open: true })
    await flushPromises()

    const input = inputByPlaceholder(wrapper, '3000').element as HTMLInputElement
    expect(document.activeElement).toBe(input)
  })

  it('shows command failures inside the dialog', async () => {
    const wrapper = mountDialog({ rejectCommand: 'inspect_port' })
    const messages: Array<[string, string | undefined]> = []
    await wrapper.setProps({
      onMessage: (text: string, type?: string) => messages.push([text, type]),
    })

    await inputByPlaceholder(wrapper, '3000').setValue('3815')
    await buttonContaining(wrapper, '查询', true).trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('lsof 查询失败: permission denied')
    expect(messages.at(-1)).toEqual(['lsof 查询失败: permission denied', 'error'])
  })

  it('shows kill failures after confirming kill', async () => {
    const wrapper = mountDialog({ rejectCommand: 'kill_port_pid' })
    const messages: Array<[string, string | undefined]> = []
    await wrapper.setProps({
      onMessage: (text: string, type?: string) => messages.push([text, type]),
    })

    await inputByPlaceholder(wrapper, '3000').setValue('3815')
    await buttonContaining(wrapper, '查询', true).trigger('click')
    await flushPromises()
    await buttonContaining(wrapper, 'Kill', true).trigger('click')
    await flushPromises()
    await buttonContaining(wrapper, '确认 Kill', true).trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('PID 123 仍在监听端口 3815')
    expect(messages.at(-1)).toEqual(['PID 123 仍在监听端口 3815', 'error'])
  })

  it('keeps the success message after refreshing killed port results', async () => {
    const wrapper = mountDialog({ clearPortAfterKill: true })
    const messages: Array<[string, string | undefined]> = []
    await wrapper.setProps({
      onMessage: (text: string, type?: string) => messages.push([text, type]),
    })

    await inputByPlaceholder(wrapper, '3000').setValue('3815')
    await buttonContaining(wrapper, '查询', true).trigger('click')
    await flushPromises()
    await buttonContaining(wrapper, 'Kill', true).trigger('click')
    await flushPromises()
    await buttonContaining(wrapper, '确认 Kill', true).trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('已结束 PID 123（端口 3815）')
    expect(document.body.textContent).toContain('端口 3815 暂无监听进程')
    expect(messages.at(-1)).toEqual(['已结束 PID 123（端口 3815）', 'success'])
  })
})
