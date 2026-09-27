<script setup lang="ts">
import {ref} from 'vue'
defineProps<{disabled?:boolean}>()
const emit=defineEmits<{approve:[scope:'once'|'similar'|'full']}>()
const menu=ref<HTMLDetailsElement>()
function approve(scope:'once'|'similar'|'full'){
  if(menu.value)menu.value.open=false
  emit('approve',scope)
}
</script>
<template>
  <div class="approval-button" @keydown.esc="menu && (menu.open=false)">
    <button type="button" :disabled="disabled" @click="approve('once')">批准本次</button>
    <details ref="menu" @focusout="!$el.contains($event.relatedTarget) && menu && (menu.open=false)">
      <summary aria-label="更多批准方式" :aria-disabled="disabled" @click="disabled && $event.preventDefault()">▾</summary>
      <div class="approval-menu">
        <button type="button" :disabled="disabled" @click="approve('once')">批准本次</button>
        <button type="button" :disabled="disabled" @click="approve('similar')">批准并允许本轮相同命令</button>
        <button type="button" :disabled="disabled" @click="approve('full')">批准并开启完全访问（当前会话）</button>
      </div>
    </details>
  </div>
</template>
<style scoped>
.approval-button{display:inline-flex;position:relative;border-radius:10px;background:var(--s-text);color:var(--s-panel)}
.approval-button>button,.approval-button summary{border:0;background:transparent;color:inherit;font:inherit;padding:10px 14px;cursor:pointer}
.approval-button>button{border-radius:10px 0 0 10px}.approval-button summary{list-style:none;border-left:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:0 10px 10px 0;padding:10px}.approval-button summary::-webkit-details-marker{display:none}
.approval-menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:20;min-width:270px;padding:5px;border:1px solid var(--s-border);border-radius:10px;background:var(--s-panel);color:var(--s-text);box-shadow:0 6px 24px #0002}
.approval-menu button{display:block;width:100%;padding:10px;border:0;border-radius:6px;text-align:left;font:inherit;color:inherit;background:transparent;cursor:pointer}.approval-menu button:hover{background:var(--s-muted)}
button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}
</style>
