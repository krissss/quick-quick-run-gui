import { describe, expect, it } from 'vitest'
import { capabilitiesForType } from '@/components/app/capabilities/capabilityRegistry'
import { serviceApp, webApp } from '../../../../fixtures/apps'

describe('capabilityRegistry', () => {
  it('declares all capabilities that can be mounted by app type', () => {
    expect(capabilitiesForType('web').map(item => item.id)).toEqual([
      'type-target',
      'name',
      'working-directory',
      'web-url',
      'command',
      'command-parameters',
      'startup',
      'window-size',
    ])
    expect(capabilitiesForType('service').map(item => item.id)).toEqual([
      'type-target',
      'name',
      'working-directory',
      'command',
      'command-parameters',
      'startup',
      'restart',
    ])
    expect(capabilitiesForType('task').map(item => item.id)).toEqual([
      'type-target',
      'name',
      'working-directory',
      'command',
      'command-parameters',
      'startup',
      'schedule',
      'retry',
    ])
  })

  it('hides conditional runtime capabilities when an app does not use them', () => {
    expect(capabilitiesForType('web', webApp).map(item => item.id)).toEqual([
      'type-target',
      'name',
      'working-directory',
      'web-url',
      'command',
      'startup',
      'window-size',
    ])

    expect(capabilitiesForType('service', {
      ...serviceApp,
      command: 'pnpm worker {account=demo : 账号}',
    }).map(item => item.id)).toEqual([
      'type-target',
      'name',
      'working-directory',
      'command',
      'command-parameters',
      'startup',
      'restart',
    ])
  })
})
