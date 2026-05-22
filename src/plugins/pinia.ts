import type { App } from 'vue'
import { createPinia } from 'pinia'

export function installPinia(app: App) {
  app.use(createPinia())
}
