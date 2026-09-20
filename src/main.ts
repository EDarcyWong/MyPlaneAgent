import {createApp} from 'vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './style.css'
import LocalAiStudio from './LocalAiStudio.vue'
import {installTooltips} from './tooltips'
const disposeTooltips=installTooltips()
if(import.meta.hot)import.meta.hot.dispose(disposeTooltips)
createApp(LocalAiStudio,{standalone:true}).mount('#app')
