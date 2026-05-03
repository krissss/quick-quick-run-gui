import { DOMWrapper, type VueWrapper } from '@vue/test-utils'

export function buttonContaining(wrapper: VueWrapper, text: string, exact = false) {
  const matches = (value: string) => exact ? value.trim() === text : value.includes(text)
  const button = wrapper.findAll('button').find((item) => matches(item.text()))
  if (button) return button
  const element = Array.from(document.querySelectorAll('button')).find((item) => matches(item.textContent ?? ''))
  if (element) return new DOMWrapper(element)
  throw new Error(`Button not found: ${text}\n${document.body.textContent}`)
}

export function inputByPlaceholder(wrapper: VueWrapper, placeholder: string) {
  const input = wrapper.findAll('input').find((item) => item.attributes('placeholder') === placeholder)
  if (input) return input
  const element = Array.from(document.querySelectorAll('input')).find((item) => item.getAttribute('placeholder') === placeholder)
  if (element) return new DOMWrapper(element)
  throw new Error(`Input not found: ${placeholder}`)
}

export function inputByValue(wrapper: VueWrapper, value: string) {
  const input = wrapper.findAll('input').find((item) => (item.element as HTMLInputElement).value === value)
  if (input) return input
  const element = Array.from(document.querySelectorAll('input')).find((item) => item.value === value)
  if (element) return new DOMWrapper(element)
  throw new Error(`Input with value not found: ${value}`)
}

export function visibleAppIds() {
  return Array.from(document.querySelectorAll('[data-app-id]'))
    .map((item) => (item as HTMLElement).dataset.appId)
    .filter((id): id is string => !!id)
}
