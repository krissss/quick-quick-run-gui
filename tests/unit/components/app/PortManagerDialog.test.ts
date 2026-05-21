import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PortManagerDialog from '@/components/app/PortManagerDialog.vue'
import { buttonContaining, inputByPlaceholder } from '../../../helpers/dom'
import { setupTauriMocks } from '../../../helpers/tauri'

const nodeProcess = {
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
}

const viteProcess = {
  pid: 456,
  command: 'node',
  full_command: 'node /repo/node_modules/.bin/vite --host 127.0.0.1',
  parent_pid: 1,
  process_role: '独立进程',
  user: '501',
  protocol: '',
  address: '',
  port: 0,
  raw: '456 501 node node /repo/node_modules/.bin/vite --host 127.0.0.1',
}

function mountDialog(props: {
  open?: boolean
  rejectCommand?: 'inspect_port' | 'kill_port_pid' | 'inspect_process_name' | 'kill_process_pid'
  clearPortAfterKill?: boolean
  clearNameAfterKill?: boolean
} = {}) {
  const portProcesses = props.clearPortAfterKill
    ? {
        3815: [nodeProcess],
      }
    : {
        3815: [nodeProcess],
      }
  setupTauriMocks({
    portProcesses,
    namedProcesses: {
      vite: [viteProcess],
    },
    clearPortAfterKill: props.clearPortAfterKill,
    clearNameAfterKill: props.clearNameAfterKill,
    rejectCommands: props.rejectCommand
      ? {
          [props.rejectCommand]: {
            inspect_port: 'lsof 查询失败: permission denied',
            kill_port_pid: 'PID 123 仍在监听端口 3815',
            inspect_process_name: 'ps 查询失败: permission denied',
            kill_process_pid: 'PID 456 仍在运行',
          }[props.rejectCommand],
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

function clearInputButton() {
  const button = document.querySelector('button[aria-label="清空输入"]')
  if (!button) throw new Error('Clear input button not found')
  return button
}

describe('PortManagerDialog', () => {
  it('focuses the port input when opened', async () => {
    const wrapper = mountDialog({ open: false })

    await wrapper.setProps({ open: true })
    await flushPromises()

    const input = inputByPlaceholder(wrapper, '3000').element as HTMLInputElement
    expect(document.activeElement).toBe(input)
  })

  it('clears the active inspect input without affecting other inputs', async () => {
    const wrapper = mountDialog()

    await inputByPlaceholder(wrapper, '3000').setValue('3815')
    clearInputButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect((inputByPlaceholder(wrapper, '3000').element as HTMLInputElement).value).toBe('')

    await buttonContaining(wrapper, '名称', true).trigger('click')
    await inputByPlaceholder(wrapper, 'node').setValue('vite')
    clearInputButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect((inputByPlaceholder(wrapper, 'node').element as HTMLInputElement).value).toBe('')
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

  it('does not emit a toast when no process is found', async () => {
    const wrapper = mountDialog()
    const messages: Array<[string, string | undefined]> = []
    await wrapper.setProps({
      onMessage: (text: string, type?: string) => messages.push([text, type]),
    })

    await inputByPlaceholder(wrapper, '3000').setValue('4321')
    await buttonContaining(wrapper, '查询', true).trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('端口 4321 当前没有监听进程')
    expect(messages).toEqual([])
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

  it('finds processes by name and kills a matching pid', async () => {
    const wrapper = mountDialog({ clearNameAfterKill: true })
    const messages: Array<[string, string | undefined]> = []
    await wrapper.setProps({
      onMessage: (text: string, type?: string) => messages.push([text, type]),
    })

    await buttonContaining(wrapper, '名称', true).trigger('click')
    await inputByPlaceholder(wrapper, 'node').setValue('vite')
    await buttonContaining(wrapper, '查询', true).trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('node')
    expect(document.body.textContent).toContain('vite')
    expect(document.body.textContent).toContain('命令行包含 "vite"')
    expect(document.body.textContent).toContain('用户 501')

    await buttonContaining(wrapper, 'Kill', true).trigger('click')
    await flushPromises()
    await buttonContaining(wrapper, '确认 Kill', true).trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('已结束 PID 456（名称 vite）')
    expect(document.body.textContent).toContain('名称 vite 暂无匹配进程')
    expect(messages.at(-1)).toEqual(['已结束 PID 456（名称 vite）', 'success'])
  })
})
