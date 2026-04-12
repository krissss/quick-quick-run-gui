import { createApp } from 'vue'
import './style.css'
import { initTheme } from './lib/theme'
import AppWindow from './AppWindow.vue'

initTheme()
createApp(AppWindow).mount('#app')
