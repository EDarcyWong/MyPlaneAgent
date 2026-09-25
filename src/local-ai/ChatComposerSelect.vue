<script setup lang="ts">
import {ref} from 'vue'
import {ElSelect,ElOption} from 'element-plus'
import {Check,Setting} from '@element-plus/icons-vue'
withDefaults(defineProps<{modelValue:string;models:{id:string;name?:string;instanceId?:string;description?:string}[];disabled?:boolean;label?:string;heading?:string;permission?:boolean}>(),{label:'会话模型',heading:'选择模型'})
const emit=defineEmits<{'update:modelValue':[value:string];manage:[]}>()
const select=ref<InstanceType<typeof ElSelect>>()
function openModels(){select.value?.blur();emit('manage')}
const root=ref<HTMLElement>(),theme=ref<Record<string,string>>({})
function syncTheme(){
 if(!root.value)return
 const source=getComputedStyle(root.value)
 theme.value={colorScheme:source.colorScheme,...Object.fromEntries(['--s-panel','--s-muted','--s-border','--s-text','--s-dim','--s-accent','--s-accent-soft'].map(name=>[name,source.getPropertyValue(name)]))}
}
</script>
<template>
 <div ref="root" class="chat-model-select" :class="{'permission-select':permission}" @pointerdown="syncTheme" @focusin="syncTheme">
  <ElSelect ref="select" :model-value="modelValue" :disabled="disabled||!models.length" :aria-label="label" :placeholder="heading" :filterable="models.length>8" no-match-text="未找到匹配的模型" :placement="permission?'top-start':'top-end'" :fallback-placements="['bottom-end','top-start']" :show-arrow="false" :offset="8" :fit-input-width="false" :popper-class="permission?'chat-model-menu chat-permission-menu':'chat-model-menu'" :popper-style="theme" @visible-change="syncTheme" @update:model-value="emit('update:modelValue',String($event))">
   <template #header><div class="model-menu-heading">{{heading}}<div v-if="!permission" class="model-menu-actions"><span>{{models.length}} 个可用</span><button type="button" class="model-menu-manage" title="打开模型切换界面" aria-label="打开模型切换界面" @click.stop="openModels"><Setting/></button></div></div></template>
   <ElOption v-for="item in models" :key="item.instanceId||item.id" :value="item.instanceId||item.id" :label="item.name||item.id"><span class="model-option-name" :title="item.name||item.id">{{item.name||item.id}}<small v-if="item.description">{{item.description}}</small></span><Check v-if="modelValue===(item.instanceId||item.id)" class="model-option-check"/></ElOption>
   <template #empty><p class="model-menu-empty">暂无可用模型</p></template>
  </ElSelect>
 </div>
</template>
<style scoped>
.chat-model-select{min-width:0;width:100%;--el-color-primary:var(--s-accent);--el-text-color-regular:var(--s-text);--el-text-color-placeholder:var(--s-dim)}.chat-model-select :deep(.el-select){width:100%}.chat-model-select :deep(.el-select__wrapper){min-height:31px;padding:5px 10px;border-radius:9px;background:transparent;box-shadow:none;font-size:12px;transition:background .15s}.chat-model-select :deep(.el-select__wrapper:hover),.chat-model-select :deep(.el-select__wrapper.is-focused){background:var(--s-muted);box-shadow:none}.chat-model-select :deep(.el-select__wrapper.is-focused){outline:1px solid var(--s-border)}.chat-model-select :deep(.el-select__selected-item){text-align:right;color:var(--s-text)}.chat-model-select :deep(.el-select__caret){color:var(--s-dim);font-size:13px}.chat-model-select :deep(.el-select__wrapper.is-disabled){background:transparent;opacity:.5;cursor:default}
.permission-select{width:110px;flex:none}.permission-select :deep(.el-select__selected-item){text-align:left}
</style>
<style>
.chat-model-menu.el-popper{min-width:min(280px,calc(100vw - 24px));max-width:min(420px,calc(100vw - 24px));border:1px solid var(--s-border,#e5e5e5);border-radius:12px;background:var(--s-panel,#fff);box-shadow:0 8px 28px #0002;overflow:hidden;--el-bg-color-overlay:var(--s-panel,#fff);--el-fill-color-light:var(--s-muted,#f5f5f5);--el-color-primary:var(--s-accent,#24755f);--el-text-color-regular:var(--s-text,#222);--el-text-color-secondary:var(--s-dim,#777)}.chat-model-menu .el-select-dropdown__header{padding:11px 13px 9px;border-bottom:1px solid var(--s-border,#e5e5e5)}.chat-model-menu .model-menu-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;font-size:11px;color:var(--s-dim,#777)}.chat-model-menu .model-menu-actions{display:flex;align-items:center;gap:8px}.chat-model-menu .model-menu-manage{display:grid;place-items:center;width:24px;height:24px;padding:4px;border:0;border-radius:6px;background:transparent;color:var(--s-dim,#777);cursor:pointer}.chat-model-menu .model-menu-manage:hover{background:var(--s-muted,#f5f5f5);color:var(--s-text,#222)}.chat-model-menu .model-menu-manage:focus-visible{outline:2px solid var(--s-accent,#24755f);outline-offset:1px}.chat-model-menu .model-menu-manage svg{width:15px;height:15px}.chat-model-menu .model-menu-heading span{font-size:10px}.chat-model-menu .el-select-dropdown__list{padding:5px}.chat-model-menu .el-select-dropdown__item{display:flex;align-items:center;gap:18px;height:36px;margin:2px 0;padding:0 10px;border-radius:7px;color:var(--s-text,#222);font-size:12px;line-height:36px}.chat-model-menu .el-select-dropdown__item.is-hovering{background:var(--s-muted,#f5f5f5)}.chat-model-menu .el-select-dropdown__item.is-selected{background:var(--s-accent-soft,#edf6f1);color:var(--s-text,#222);font-weight:500}.chat-model-menu .model-option-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-model-menu .model-option-check{width:15px;height:15px;flex:none;color:var(--s-accent,#24755f)}.chat-permission-menu .el-select-dropdown__item{height:auto;min-height:58px;line-height:20px;padding:8px 10px}.chat-permission-menu .model-option-name{white-space:normal}.chat-permission-menu .model-option-name small{display:block;max-width:290px;margin-top:3px;color:var(--s-dim,#777);font-size:11px;font-weight:400;line-height:17px}.chat-model-menu .model-menu-empty{padding:12px;margin:0;text-align:center;font-size:12px;color:var(--s-dim,#777)}
</style>
