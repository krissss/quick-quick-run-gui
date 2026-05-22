import {
  defaultRestart,
  defaultRetry,
  defaultSchedule,
  defaultStartup,
  type AppItem,
} from '@/lib/store'

export function emptyApp(): AppItem {
  return {
    id: '',
    name: '',
    type: 'web',
    command: '',
    workingDirectory: '',
    url: '',
    width: 1200,
    height: 800,
    profiles: [],
    activeProfileId: '',
    schedule: defaultSchedule(),
    startup: defaultStartup(),
    restart: defaultRestart(),
    retry: defaultRetry(),
  }
}

export function defaultAppName(app: AppItem) {
  const command = app.command.trim()
  if (command) return command
  if (app.type === 'web') return app.url.trim()
  return ''
}
