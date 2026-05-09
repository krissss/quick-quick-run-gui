import type { AppItem } from '@/lib/store'
import type { RunRecord } from '@/composables/useLauncher'

export const baseSchedule = {
  enabled: false,
  cron: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  missedPolicy: 'skip' as const,
}

export const baseStartup = {
  enabled: false,
  delaySeconds: 0,
}

export const baseRestart = {
  enabled: false,
  mode: 'on-failure' as const,
  maxAttempts: 3,
  delaySeconds: 3,
}

export const baseRetry = {
  enabled: false,
  maxAttempts: 2,
  delaySeconds: 3,
}

export const webApp: AppItem = {
  id: 'web-1',
  name: 'demo-web',
  type: 'web',
  command: 'pnpm dev',
  workingDirectory: '/Users/demo/demo-web',
  url: 'http://localhost:3000',
  width: 1200,
  height: 800,
  profiles: [],
  activeProfileId: '',
  schedule: baseSchedule,
  startup: baseStartup,
  restart: baseRestart,
  retry: baseRetry,
}

export const serviceApp: AppItem = {
  id: 'service-1',
  name: 'worker',
  type: 'service',
  command: 'pnpm worker',
  workingDirectory: '/Users/demo/demo-worker',
  url: '',
  width: 1200,
  height: 800,
  profiles: [],
  activeProfileId: '',
  schedule: baseSchedule,
  startup: baseStartup,
  restart: baseRestart,
  retry: baseRetry,
}

export const taskApp: AppItem = {
  id: 'task-1',
  name: 'daily',
  type: 'task',
  command: 'pnpm daily',
  workingDirectory: '/Users/demo/daily-report',
  url: '',
  width: 1200,
  height: 800,
  profiles: [],
  activeProfileId: '',
  schedule: { ...baseSchedule, enabled: true, cron: '0 9 * * *', missedPolicy: 'run-once' },
  startup: baseStartup,
  restart: baseRestart,
  retry: baseRetry,
}

export const serviceFailedRun: RunRecord = {
  id: 'run-service',
  app_id: 'service-1',
  app_name: 'worker',
  item_type: 'service',
  status: 'failed',
  pid: null,
  exit_code: 1,
  started_at: 2,
  finished_at: 3,
  log_path: '',
  trigger: 'manual',
}

export const taskSuccessRun: RunRecord = {
  id: 'run-task',
  app_id: 'task-1',
  app_name: 'daily',
  item_type: 'task',
  status: 'success',
  pid: null,
  exit_code: 0,
  started_at: 4,
  finished_at: 5,
  log_path: '',
  trigger: 'schedule',
}
