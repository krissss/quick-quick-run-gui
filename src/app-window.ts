import { createApp } from 'vue'
import './style.css'
import { initTheme } from './lib/theme'
import { installPinia } from './plugins/pinia'
import AppWindow from './AppWindow.vue'

initTheme()
const app = createApp(AppWindow)
installPinia(app)
app.mount('#app')
