<script setup lang="ts">
import AiMarkdown from '../AiMarkdown.vue'
import TokenUsageDisplay from './TokenUsageDisplay.vue'
import {CopyDocument,Refresh} from '@element-plus/icons-vue'
import {readTokenUsage,sumTokenUsage} from '../../electron/shared/local-ai-usage'
import type {StudioMessage} from '../../electron/shared/local-ai-studio'
defineProps<{messages:StudioMessage[];sending:boolean}>()
defineEmits<{copy:[text:string];regenerate:[]}>()
const messageUsage=(message:StudioMessage)=>message.usage||readTokenUsage({usage:{completion_tokens:message.tokens}})
</script>
<template>
<div class="messages"><article v-for="(message,index) in messages" :key="message.id" class="message" :class="message.role"><div class="message-body"><header v-if="message.role==='assistant'"><span v-if="message.elapsedMs">{{(message.elapsedMs/1000).toFixed(1)}}s</span><TokenUsageDisplay :usage="sumTokenUsage([messageUsage(message)])" :pending="sending&&index===messages.length-1" label="本次 Tokens" compact/></header><details v-if="message.reasoning" class="reasoning"><summary>思考过程</summary><AiMarkdown :text="message.reasoning"/></details><div v-if="message.images?.length" class="message-images"><img v-for="(image,imageIndex) in message.images" :key="imageIndex" :src="image.dataUrl" :alt="image.name" loading="lazy"/></div><AiMarkdown v-if="message.content" :text="message.content"/><div v-else-if="message.role==='assistant'&&sending&&index===messages.length-1" class="generating"><span></span><span></span><span></span><small>正在生成</small></div><p v-if="message.status==='stopped'" class="quiet">已停止生成</p><p v-if="message.status==='error'" class="message-error">生成未完成，可重试。</p><div v-if="!sending" class="message-actions"><button class="text-button" @click="$emit('copy',message.content)"><CopyDocument/>复制</button><button v-if="message.role==='assistant'&&index===messages.length-1" class="text-button" @click="$emit('regenerate')"><Refresh/>重新生成</button></div></div></article></div>
</template>
<style scoped>
.messages{width:100%;max-width:800px;margin:auto;padding:24px}.message{margin-bottom:26px;display:flex;min-width:0}.message-body{min-width:0;flex:1}.message-body>header{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--s-dim);margin-bottom:8px}.message.user .message-body{background:var(--s-muted);padding:14px 18px;border-radius:16px;max-width:85%;margin-left:auto;flex:0 1 auto}.message :deep(.ai-markdown){font-size:15px;line-height:1.85}.message-images{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.message-images img{max-width:min(240px,100%);max-height:200px;border-radius:10px;object-fit:contain}.message-actions{display:flex;gap:12px;margin-top:10px}.text-button{display:flex;gap:5px;align-items:center;border:0;background:transparent;color:var(--s-dim);font:inherit;font-size:11px;cursor:pointer;padding:2px 0}.text-button svg{width:13px;height:13px}.reasoning{margin:8px 0 12px;color:var(--s-dim);font-size:12px}.reasoning summary{cursor:pointer}.generating{font-size:12px;color:var(--s-dim)}.quiet,.message-error{font-size:12px;color:var(--s-dim)}.message-error{color:var(--s-danger)}
</style>
