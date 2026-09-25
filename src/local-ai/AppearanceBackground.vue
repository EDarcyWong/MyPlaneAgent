<script setup lang="ts">
import {ref} from 'vue'
import {validBackgroundImage} from '../../electron/shared/app-background'
const props=defineProps<{image?:string;opacity?:number}>()
const emit=defineEmits<{change:[value:{backgroundImage:string;backgroundOpacity:number}]}>()
const input=ref<HTMLInputElement>(),busy=ref(false),error=ref('')
async function select(event:Event){
 const target=event.target as HTMLInputElement,file=target.files?.[0];target.value=''
 if(!file)return
 error.value=''
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){error.value='请选择 20 MB 以内的 JPG、PNG 或 WebP 图片。';return}
 busy.value=true
 let bitmap:ImageBitmap|undefined
 try{
  bitmap=await createImageBitmap(file)
  const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
  const context=canvas.getContext('2d');if(!context)throw Error('无法读取图片')
  context.drawImage(bitmap,0,0,canvas.width,canvas.height)
  const image=canvas.toDataURL('image/webp',0.85)
  if(!validBackgroundImage(image))throw Error('图片过大，请选择较小的图片')
  emit('change',{backgroundImage:image,backgroundOpacity:props.opacity??0.15})
 }catch{error.value='无法加载这张图片，请更换图片后重试。'}finally{bitmap?.close();busy.value=false}
}
</script>
<template>
 <section class="background-settings" aria-label="应用背景">
  <div class="background-heading"><strong>背景图片</strong><span>仅保存在本机</span></div>
  <input ref="input" hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择背景图片文件" @change="select"/>
  <div class="background-actions"><button type="button" class="secondary-button" :disabled="busy" @click="input?.click()">{{busy?'正在处理…':image?'更换图片':'选择图片'}}</button><button v-if="image" type="button" class="secondary-button" :disabled="busy" @click="emit('change',{backgroundImage:'',backgroundOpacity:0.15})">恢复默认背景</button></div>
  <label v-if="image" class="background-opacity"><span>图片浓度 <output>{{Math.round((opacity??0.15)*100)}}%</output></span><input type="range" min="0" max="40" step="1" :value="Math.round((opacity??0.15)*100)" @input="emit('change',{backgroundImage:image||'',backgroundOpacity:Number(($event.target as HTMLInputElement).value)/100})"/></label>
  <p>支持 JPG、PNG、WebP。选择后立即预览，点击“保存设置”后保留。</p>
  <p v-if="error" class="background-error" role="alert">{{error}}</p>
 </section>
</template>
<style scoped>
.background-settings{border-top:1px solid var(--s-border);margin-top:20px;padding-top:18px}.background-heading,.background-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.background-heading{justify-content:space-between;margin-bottom:12px}.background-heading strong{font-size:13px}.background-heading span,.background-settings p{font-size:11px;color:var(--s-dim)}.background-actions button{font-size:12px}.background-opacity{display:block;margin-top:16px}.background-opacity>span{display:flex;justify-content:space-between;font-size:12px}.background-opacity input{width:100%;margin:10px 0 0;accent-color:var(--s-accent)}.background-settings .background-error{color:var(--s-danger)}
</style>
