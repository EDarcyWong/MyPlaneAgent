<script setup lang="ts">
import {ElDropdown,ElDropdownMenu,ElDropdownItem} from 'element-plus'
import {Download} from '@element-plus/icons-vue'
defineProps<{disabled?:boolean}>()
const emit=defineEmits<{select:[format:'md'|'pdf'|'json']}>()
function select(format:unknown){if(format==='md'||format==='pdf'||format==='json')emit('select',format)}
</script>
<template><ElDropdown trigger="click" :disabled="disabled" @command="select"><button class="agent-icon workspace-export" :disabled="disabled" title="导出会话" aria-label="导出会话"><Download/></button><template #dropdown><ElDropdownMenu><ElDropdownItem command="pdf">导出 PDF</ElDropdownItem><ElDropdownItem command="md">导出 Markdown</ElDropdownItem><ElDropdownItem command="json">导出 JSON</ElDropdownItem></ElDropdownMenu></template></ElDropdown></template>
<style scoped>button{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:var(--s-dim);cursor:pointer}button:hover{background:var(--s-muted)}button:disabled{opacity:.45;cursor:default}svg{width:16px;height:16px}</style>
