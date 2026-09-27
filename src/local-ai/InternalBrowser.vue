<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref} from 'vue'
import type {BrowserAction,BrowserState} from '../../electron/shared/browser'
const state=ref<BrowserState>({automationEnabled:false,url:'',title:'',loading:false,canGoBack:false,canGoForward:false,error:''})
const toggling=ref(false)
async function toggleAutomation(){toggling.value=true;error.value='';try{update(await window.myplane.browser('enable-automation',!state.value.automationEnabled))}catch(cause){error.value=String(cause)}finally{toggling.value=false}}
const address=ref(''),error=ref(''),editing=ref(false),dirty=ref(false),field=ref<HTMLInputElement>()
let dispose:(()=>void)|undefined
function update(value:BrowserState){state.value=value;if(!editing.value&&!dirty.value)address.value=value.url;document.title=(value.title||'内置浏览器')+' · MyPlaneAgent'}
async function action(name:BrowserAction){error.value='';try{const value=await window.myplane.browser(name,name==='navigate'?address.value:undefined);update(value)}catch(cause){error.value=String(cause)}}
function navigate(){editing.value=false;dirty.value=false;void action('navigate')}
function reload(){if(dirty.value)navigate();else void action('reload')}
onMounted(()=>{dispose=window.myplane.onBrowserState(update);void action('state')})
onBeforeUnmount(()=>dispose?.())
function shortcut(event:KeyboardEvent){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='l'){event.preventDefault();field.value?.focus();field.value?.select()}}
</script>
<template>
 <main class="internal-browser" @keydown="shortcut">
  <header><button :disabled="!state.canGoBack" aria-label="后退" title="后退" @click="action('back')">←</button><button :disabled="!state.canGoForward" aria-label="前进" title="前进" @click="action('forward')">→</button><button :disabled="!state.url&&!state.loading" :aria-label="state.loading?'停止加载':'刷新网页'" :title="state.loading?'停止加载':'刷新网页'" @click="state.loading?action('stop'):reload()">{{state.loading?'×':'↻'}}</button><form @submit.prevent="navigate"><input ref="field" v-model="address" @input="dirty=true" aria-label="网址" placeholder="输入网址，例如 example.com" spellcheck="false" @focus="editing=true" @blur="editing=false"/><button aria-label="访问网址" title="访问" type="submit">↵</button></form><button :disabled="!state.url" class="external" title="用系统浏览器打开" aria-label="用系统浏览器打开" @click="action('external')">↗</button></header>
  <div class="browser-status" role="status"><span>{{error||state.error||(state.loading?'正在加载…':state.title||'内置浏览器')}}</span><button class="automation-toggle" role="switch" :aria-checked="state.automationEnabled" :disabled="toggling" title="开启后，在会话设置中打开联网，即可让 Agent 操作当前网页" @click="toggleAutomation">{{state.automationEnabled?'自动化已开启':'启用自动化'}}</button><small v-if="state.url">{{state.url.startsWith('https:')?'HTTPS':'HTTP'}}</small></div>
  <section v-if="error||state.error" class="browser-empty"><h1>暂时无法打开网页</h1><p>{{error||state.error}}</p><p class="failed-url">请求地址：{{state.url}}</p><button @click="reload">重新加载</button></section>
  <section v-else-if="!state.url&&!state.loading" class="browser-empty"><h1>内置浏览器</h1><p>输入网址开始浏览，也可以从对话中打开网页链接。</p><button @click="field?.focus()">输入网址</button></section>
 </main>
</template>
<style scoped>
.internal-browser{flex:1;width:100%;min-width:0;height:100%;background:light-dark(#fff,#202020);color:light-dark(#242424,#ededed);font:13px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color-scheme:light dark}.internal-browser header{height:56px;display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid light-dark(#e8e8e8,#3b3b3b)}button{border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:inherit;min-width:32px;min-height:32px}header>button{font-size:20px}button:hover{background:light-dark(#eee,#383838)}button:disabled{opacity:.3;cursor:default}form{flex:1;min-width:0;display:flex;border:1px solid light-dark(#ddd,#444);border-radius:8px;background:light-dark(#f6f6f6,#2b2b2b)}input{flex:1;width:100%;min-width:0;border:0;background:transparent;color:inherit;font:inherit;padding:7px 11px;outline:none}form:focus-within{outline:2px solid light-dark(#888,#aaa);outline-offset:1px}.browser-status{height:36px;padding:7px 16px;display:flex;gap:16px;align-items:center;color:light-dark(#777,#bbb);font-size:11px;border-bottom:1px solid light-dark(#eee,#333)}.browser-status span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.automation-toggle{font-size:11px;min-height:24px;padding:2px 8px;border:1px solid currentColor;white-space:nowrap}.automation-toggle[aria-checked=true]{color:light-dark(#287747,#84cc9c)}.browser-empty{max-width:520px;margin:100px auto;padding:24px;text-align:center}.browser-empty h1{font-size:24px}.browser-empty p{overflow-wrap:anywhere;color:light-dark(#777,#bbb)}.browser-empty button{border:1px solid light-dark(#ddd,#444);padding:6px 14px;margin-top:12px}button:focus-visible{outline:2px solid currentColor}
</style>

<style scoped>
.browser-empty{width:calc(100% - 40px);margin:clamp(50px,14vh,150px) auto;padding:30px;border:1px solid light-dark(#e8e8e8,#383838);border-radius:18px;background:light-dark(#fafbfc,#242424)}.failed-url{font-family:monospace;font-size:12px}.browser-status{gap:10px}.internal-browser header{background:light-dark(#fafbfc,#242424)}.browser-empty button{background:light-dark(#edf2ff,#30394a)}
</style>
