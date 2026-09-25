<script setup lang="ts">
import {ref,watch,nextTick} from 'vue'
import {ElDialog} from 'element-plus'
import {Warning,FolderOpened,Monitor,Connection} from '@element-plus/icons-vue'
import ChatComposerSelect from './ChatComposerSelect.vue'
type Permission='ask'|'auto'|'full'
const props=defineProps<{modelValue:Permission;disabled?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:Permission]}>()
const root=ref<HTMLElement>(),cancel=ref<HTMLButtonElement>(),confirmOpen=ref(false),theme=ref<Record<string,string>>({})
const options=[
 {id:'ask',name:'请求批准',description:'联网、写入和高风险操作请求批准'},
 {id:'auto',name:'帮我批准',description:'自动允许搜索和工作目录内写入，高风险及目录外访问仍请求批准'},
 {id:'full',name:'完全访问',description:'允许访问互联网和本机文件，操作不再逐次询问'},
]
function choose(value:string){
 if(props.disabled||value===props.modelValue)return
 if(value!=='full'){if(value==='ask'||value==='auto')emit('update:modelValue',value);return}
 const source=root.value&&getComputedStyle(root.value)
 theme.value={colorScheme:source?.colorScheme||'normal',...Object.fromEntries(['--s-panel','--s-muted','--s-border','--s-text','--s-dim','--s-accent','--s-danger'].map(name=>[name,source?.getPropertyValue(name)||'']))}
 confirmOpen.value=true
}
function confirm(){if(!props.disabled)emit('update:modelValue','full');confirmOpen.value=false}
watch(()=>[props.disabled,props.modelValue],()=>{confirmOpen.value=false})
async function restoreFocus(){await nextTick();root.value?.querySelector<HTMLElement>('[role="combobox"]')?.focus()}
</script>
<template>
 <div ref="root" class="chat-permission-select">
  <ChatComposerSelect :model-value="modelValue" label="任务权限" heading="任务权限" permission :models="options" :disabled="disabled" @update:model-value="choose"/>
  <ElDialog v-model="confirmOpen" class="full-access-dialog" title="要开启完全访问权限吗？" width="min(540px,calc(100vw - 32px))" :style="theme" :show-close="false" :close-on-click-modal="false" append-to-body align-center @opened="cancel?.focus()" @closed="restoreFocus">
   <template #header><div class="full-access-heading"><Warning/><strong>要开启完全访问权限吗？</strong></div></template>
   <p class="full-access-intro">开启后，MyPlaneAgent 可以访问本机文件、运行终端命令并使用互联网，操作不再逐次请求批准。</p>
   <div class="full-access-capabilities">
    <div><FolderOpened/><span><strong>文件和文件夹</strong><small>读取、创建、修改或删除本机文件，包括工作目录以外的位置。</small></span></div>
    <div><Monitor/><span><strong>终端命令</strong><small>运行命令，可能安装软件或更改系统设置。</small></span></div>
    <div><Connection/><span><strong>互联网与工具</strong><small>访问网站、发送数据，并调用已启用的工具。</small></span></div>
   </div>
   <p class="full-access-risk">这可能带来数据丢失、敏感信息泄露及提示注入风险。请仅在信任当前任务时开启；你可以随时在权限菜单中关闭。</p>
   <template #footer><button ref="cancel" type="button" class="full-access-cancel" @click="confirmOpen=false">取消</button><button type="button" class="full-access-confirm" :disabled="disabled" @click="confirm"><Warning/>确认开启</button></template>
  </ElDialog>
 </div>
</template>
<style scoped>
.chat-permission-select{flex:none;width:110px}
</style>
<style>
.full-access-dialog.el-dialog{padding:22px;border-radius:20px;background:var(--s-panel,#fff);color:var(--s-text,#222);--el-text-color-primary:var(--s-text,#222);--el-text-color-regular:var(--s-text,#222)}.full-access-dialog .el-dialog__header{padding:0 0 14px}.full-access-heading{display:flex;align-items:center;gap:9px;font-size:20px;line-height:1.4}.full-access-heading svg{width:21px;height:21px;flex:none}.full-access-intro,.full-access-risk{margin:0;color:var(--s-dim,#777);font-size:13px;line-height:1.8}.full-access-capabilities{margin:16px 0;padding:2px 16px;border-radius:14px;background:var(--s-muted,#f5f5f5)}.full-access-capabilities>div{display:flex;align-items:center;gap:12px;padding:12px 0}.full-access-capabilities>div+div{border-top:1px solid var(--s-border,#e5e5e5)}.full-access-capabilities svg{width:23px;height:23px;flex:none;color:var(--s-accent,#24755f)}.full-access-capabilities strong{display:block;font-size:14px;font-weight:600}.full-access-capabilities small{display:block;margin-top:3px;color:var(--s-dim,#777);font-size:12px;line-height:1.6}.full-access-dialog .el-dialog__footer{display:flex;justify-content:flex-end;gap:10px;padding-top:20px}.full-access-dialog .el-dialog__footer button{display:flex;align-items:center;justify-content:center;gap:7px;min-width:86px;border:0;border-radius:20px;padding:10px 18px;font:inherit;font-size:13px;cursor:pointer}.full-access-cancel{background:var(--s-muted,#f5f5f5);color:var(--s-text,#222)}.full-access-confirm{background:color-mix(in srgb,var(--s-danger,#df4545) 12%,var(--s-panel,#fff));color:var(--s-danger,#df4545)}.full-access-confirm svg{width:16px;height:16px}.full-access-dialog button:hover{filter:brightness(.96)}.full-access-dialog button:focus-visible{outline:2px solid var(--s-accent,#24755f);outline-offset:3px}
</style>
