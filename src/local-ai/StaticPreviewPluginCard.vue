<script setup lang="ts">
import {onMounted,ref} from 'vue'
const enabled=ref(false),running=ref(0),busy=ref(false),error=ref('')
onMounted(async()=>{try{const state=await window.myplane.localAiStudio('previewPluginState');enabled.value=state.enabled;running.value=state.running}catch(cause){error.value=String(cause)}})
async function toggle(){busy.value=true;error.value='';try{const state=await window.myplane.localAiStudio('previewPluginConfigure',{enabled:!enabled.value});enabled.value=state.enabled;running.value=state.running}catch(cause){error.value=String(cause)}finally{busy.value=false}}
</script>
<template>
  <section class="builtin-plugin preview-plugin-card" aria-label="静态网页预览插件">
    <header><div><div class="plugin-title"><h2>静态网页预览</h2><span>内置插件</span></div><p>为项目启动本地静态网页预览。</p></div></header>
    <div class="plugin-state"><div><strong>允许 Agent 使用</strong><small>{{ enabled ? '已启用' : '已停用' }} · {{ running }} 个服务运行中</small></div><button class="plugin-switch" role="switch" :aria-checked="enabled" aria-label="启用静态网页预览插件" :disabled="busy" @click="toggle"><span/></button></div>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <section class="plugin-section"><h3>提供的能力</h3><ul><li>启动、查询和停止本地静态网页服务</li><li>无需 package.json 或额外执行命令</li></ul></section>
    <section class="plugin-section"><h3>使用条件</h3><p>选择项目目录并开启会话联网。启动后，通过工具返回的网址访问预览。</p><p>停用插件或退出应用会停止该插件启动的服务。</p></section>
  </section>
</template>
<style scoped src="./builtin-plugin-detail.css"></style>
