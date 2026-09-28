<script setup lang="ts">
import {ref} from 'vue'
import {backgroundPresets,backgroundPreset,validBackgroundImage} from '../../electron/shared/app-background'
import {backgroundImageUrl} from './background-presets'
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
  <section v-for="group in ['科技光影','中国水墨']" :key="group" class="background-group" :aria-label="group">
  <h3>{{group}}</h3>
  <div class="background-presets" role="group" :aria-label="`${group}背景`">
   <button v-for="preset in backgroundPresets.filter(item=>item.group===group)" :key="preset.id" type="button" :aria-pressed="image===`builtin:${preset.id}`" :aria-label="`选择背景：${preset.name}`" :disabled="busy" @click="error='';emit('change',{backgroundImage:`builtin:${preset.id}`,backgroundOpacity:opacity && opacity>0?opacity:0.2})">
    <img :src="backgroundImageUrl(`builtin:${preset.id}`)" alt="" loading="lazy"/>
    <span><strong>{{preset.name}}</strong><small>{{preset.theme}}</small></span>
    <i v-if="image===`builtin:${preset.id}`" aria-hidden="true">✓</i>
   </button>
  </div>
  </section>
  <p v-if="backgroundPreset(image)" class="background-selection">当前：{{backgroundPreset(image)?.name}}</p>
  <div class="background-actions"><button type="button" class="secondary-button" :disabled="busy" @click="input?.click()">{{busy?'正在处理…':'上传自定义图片'}}</button><button v-if="image" type="button" class="secondary-button" :disabled="busy" @click="emit('change',{backgroundImage:'',backgroundOpacity:0.15})">恢复默认背景</button></div>
  <label v-if="image" class="background-opacity"><span>图片浓度 <output>{{Math.round((opacity??0.15)*100)}}%</output></span><input type="range" min="0" max="40" step="1" :value="Math.round((opacity??0.15)*100)" @input="emit('change',{backgroundImage:image||'',backgroundOpacity:Number(($event.target as HTMLInputElement).value)/100})"/></label>
  <p>支持 JPG、PNG、WebP。选择后立即预览，点击“保存设置”后保留。</p>
  <p v-if="error" class="background-error" role="alert">{{error}}</p>
 </section>
</template>
<style scoped>
.background-group h3{margin:0 0 10px;font-size:12px;font-weight:500;color:var(--s-dim)}
.background-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-bottom:16px}.background-presets button{position:relative;min-width:0;padding:0;overflow:hidden;border:1px solid var(--s-border);border-radius:8px;background:var(--s-bg);color:var(--s-text);text-align:left;cursor:pointer}.background-presets button:hover{border-color:var(--s-accent)}.background-presets button[aria-pressed=true]{border-color:var(--s-accent);box-shadow:0 0 0 1px var(--s-accent)}.background-presets button:focus-visible{outline:2px solid var(--s-accent);outline-offset:3px}.background-presets img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}.background-presets span{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 10px}.background-presets strong{font-size:12px;font-weight:500}.background-presets small{font-size:10px;color:var(--s-dim)}.background-presets i{position:absolute;right:8px;top:8px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--s-accent);color:var(--s-on-accent);font-size:12px;font-style:normal}.background-settings .background-selection{margin:0 0 12px;color:var(--s-accent)}
.background-settings{border-top:1px solid var(--s-border);margin-top:20px;padding-top:18px}.background-heading,.background-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.background-heading{justify-content:space-between;margin-bottom:12px}.background-heading strong{font-size:13px}.background-heading span,.background-settings p{font-size:11px;color:var(--s-dim)}.background-actions button{font-size:12px}.background-opacity{display:block;margin-top:16px}.background-opacity>span{display:flex;justify-content:space-between;font-size:12px}.background-opacity input{width:100%;margin:10px 0 0;accent-color:var(--s-accent)}.background-settings .background-error{color:var(--s-danger)}
</style>
