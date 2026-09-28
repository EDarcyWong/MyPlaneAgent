<script setup lang="ts">
import {onMounted,ref} from 'vue'
const enabled=ref(false),busy=ref(false),error=ref('')
onMounted(async()=>{try{enabled.value=(await window.myplane.browser('plugin-state')).automationEnabled}catch(cause){error.value=String(cause)}})
async function toggle(){busy.value=true;error.value='';try{enabled.value=(await window.myplane.browser('enable-automation',!enabled.value)).automationEnabled}catch(cause){error.value=String(cause)}finally{busy.value=false}}
async function open(){try{await window.myplane.browser('open')}catch(cause){error.value=String(cause)}}
</script>
<template>
  <section class="builtin-plugin browser-plugin-card" aria-label="浏览器自动化插件">
    <header><div><div class="plugin-title"><h2>浏览器自动化</h2><span>内置插件</span></div><p>让 Agent 浏览网页并完成页面交互。</p></div><button class="plugin-action" @click="open">打开浏览器</button></header>
    <div class="plugin-state"><div><strong>允许 Agent 使用</strong><small>{{ enabled ? '已启用' : '已停用' }}</small></div><button class="plugin-switch" role="switch" :aria-checked="enabled" aria-label="启用浏览器自动化插件" :disabled="busy" @click="toggle"><span/></button></div>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <section class="plugin-section"><h3>提供的能力</h3><ul><li>打开网页、读取内容与检查页面布局</li><li>点击元素或画布、填写表单、切换选项</li><li>截取页面，辅助验证操作结果</li></ul></section>
    <section class="plugin-section"><h3>使用条件</h3><p>需开启会话联网，网页操作遵循当前任务权限。</p></section>
  </section>
</template>
<style scoped src="./builtin-plugin-detail.css"></style>
