import { createApp } from 'vue'
import './style.css'
import { initTheme } from './lib/theme'
import { installPinia } from './plugins/pinia'
import App from './App.vue'

initTheme()
const app = createApp(App)
installPinia(app)
app.mount('#app')
