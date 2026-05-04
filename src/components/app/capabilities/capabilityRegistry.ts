import type { Component } from 'vue'
import { parseCommandSignature, type AppItem, type AppType } from '@/lib/store'
import CommandCapability from './CommandCapability.vue'
import CommandParametersCapability from './CommandParametersCapability.vue'
import NameCapability from './NameCapability.vue'
import RestartCapability from './RestartCapability.vue'
import RetryCapability from './RetryCapability.vue'
import ScheduleCapability from './ScheduleCapability.vue'
import StartupCapability from './StartupCapability.vue'
import TypeTargetCapability from './TypeTargetCapability.vue'
import WebUrlCapability from './WebUrlCapability.vue'
import WorkingDirectoryCapability from './WorkingDirectoryCapability.vue'
import WindowSizeCapability from './WindowSizeCapability.vue'

const allTypes: AppType[] = ['web', 'service', 'task']

export interface AppCapabilityDefinition {
  id: string
  label: string
  order: number
  types: AppType[]
  component: Component
  visible?: (app: AppItem) => boolean
}

export const appCapabilityRegistry: AppCapabilityDefinition[] = [
  {
    id: 'type-target',
    label: '类型目标',
    order: 10,
    types: allTypes,
    component: TypeTargetCapability,
  },
  {
    id: 'web-url',
    label: '目标 URL',
    order: 20,
    types: ['web'],
    component: WebUrlCapability,
  },
  {
    id: 'command',
    label: '命令',
    order: 30,
    types: allTypes,
    component: CommandCapability,
  },
  {
    id: 'command-parameters',
    label: '运行参数',
    order: 35,
    types: allTypes,
    component: CommandParametersCapability,
    visible: app => parseCommandSignature(app.command).params.length > 0,
  },
  {
    id: 'working-directory',
    label: '工作目录',
    order: 40,
    types: allTypes,
    component: WorkingDirectoryCapability,
  },
  {
    id: 'startup',
    label: '启动策略',
    order: 45,
    types: allTypes,
    component: StartupCapability,
  },
  {
    id: 'restart',
    label: '重启策略',
    order: 50,
    types: ['service'],
    component: RestartCapability,
  },
  {
    id: 'schedule',
    label: '定时执行',
    order: 55,
    types: ['task'],
    component: ScheduleCapability,
  },
  {
    id: 'retry',
    label: '失败重试',
    order: 56,
    types: ['task'],
    component: RetryCapability,
  },
  {
    id: 'window-size',
    label: '窗口尺寸',
    order: 60,
    types: ['web'],
    component: WindowSizeCapability,
  },
  {
    id: 'name',
    label: '名称',
    order: 70,
    types: allTypes,
    component: NameCapability,
  },
]

export function capabilitiesForType(type: AppType, app?: AppItem) {
  return appCapabilityRegistry
    .filter(capability => capability.types.includes(type))
    .filter(capability => !app || !capability.visible || capability.visible(app))
    .sort((a, b) => a.order - b.order)
}
