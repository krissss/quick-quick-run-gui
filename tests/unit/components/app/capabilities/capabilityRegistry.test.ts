import { describe, expect, it } from 'vitest'
import { capabilitiesForType } from '@/components/app/capabilities/capabilityRegistry'
import { serviceApp, webApp } from '../../../../fixtures/apps'

describe('capabilityRegistry', () => {
  it('declares all capabilities that can be mounted by app type', () => {
    expect(capabilitiesForType('web').map(item => item.id)).toEqual([
      'type-target',
      'web-url',
      'command',
      'command-parameters',
      'working-directory',
      'startup',
      'window-size',
      'name',
    ])
    expect(capabilitiesForType('service').map(item => item.id)).toEqual([
      'type-target',
      'command',
      'command-parameters',
      'working-directory',
      'startup',
      'restart',
      'name',
    ])
    expect(capabilitiesForType('task').map(item => item.id)).toEqual([
      'type-target',
      'command',
      'command-parameters',
      'working-directory',
      'startup',
      'schedule',
      'retry',
      'name',
    ])
  })

  it('hides conditional runtime capabilities when an app does not use them', () => {
    expect(capabilitiesForType('web', webApp).map(item => item.id)).toEqual([
      'type-target',
      'web-url',
      'command',
      'working-directory',
      'startup',
      'window-size',
      'name',
    ])

    expect(capabilitiesForType('service', {
      ...serviceApp,
      command: 'pnpm worker {account=demo : 账号}',
    }).map(item => item.id)).toEqual([
      'type-target',
      'command',
      'command-parameters',
      'working-directory',
      'startup',
      'restart',
      'name',
    ])
  })
})
