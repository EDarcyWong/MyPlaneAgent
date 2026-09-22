<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { helpDocuments } from './help-documents'

const props = defineProps<{ documentId?: string }>()
const document = helpDocuments.find(item => item.id === props.documentId) || helpDocuments[0]
const query = ref(''), activeId = ref('section-1'), searchInput = ref<HTMLInputElement>()
const reader = ref<HTMLElement>()
const sections = document.content.split(/^## /m).filter(part => part.trim()).map((part, index) => {
  const newline = part.indexOf('\n')
  const title = part.slice(0, newline).trim()
  const markdown = part.slice(newline + 1).trim()
  return {
    id: `section-${index + 1}`, title, searchText: `${title}\n${markdown}`.toLocaleLowerCase(),
    html: DOMPurify.sanitize(marked.parse(markdown, { async: false })),
  }
})
const visibleSections = computed(() => {
  const terms = query.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return sections.filter(section => terms.every(term => section.searchText.includes(term)))
})
watch(visibleSections, async sections => {
  activeId.value = sections[0]?.id || ''
  await nextTick()
  reader.value?.scrollTo({ top: 0 })
})
function navigate(id: string) {
  activeId.value = id
  const heading = globalThis.document.getElementById(id)
  heading?.scrollIntoView({ block: 'start' })
  heading?.focus({ preventScroll: true })
}
function keyDown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    searchInput.value?.focus()
    searchInput.value?.select()
  }
}
onMounted(() => window.addEventListener('keydown', keyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', keyDown))
</script>

<template>
  <div class="help-window">
    <header class="help-header">
      <div><span class="help-brand">MyPlaneAgent · 帮助文档</span><h1>{{ document.title }}</h1><p>{{ document.description }}</p></div>
      <span class="help-badge">离线可用</span>
    </header>
    <div class="help-layout">
      <aside class="help-sidebar">
        <label for="help-search">搜索文档</label>
        <div class="help-search"><input id="help-search" ref="searchInput" v-model="query" type="search" placeholder="组件、JSON、用例…" autocomplete="off" /><button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">清空</button></div>
        <p class="help-search-status" aria-live="polite">{{ query.trim() ? `${visibleSections.length} 个匹配章节` : `${sections.length} 个章节 · Ctrl/Cmd+F 搜索` }}</p>
        <nav aria-label="帮助文档目录">
          <button v-for="(section, index) in visibleSections" :key="section.id" type="button" :class="{ active: activeId === section.id }" :aria-current="activeId === section.id ? 'location' : undefined" @click="navigate(section.id)"><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ section.title }}</button>
        </nav>
        <p class="help-sidebar-note">帮助在独立窗体中打开，可与编辑器并排查看。</p>
      </aside>
      <main ref="reader" class="help-reader" aria-label="帮助文档正文">
        <div v-if="!visibleSections.length" class="help-empty"><h2>没有找到匹配章节</h2><p>试试“汇合”“变量”或“输出”，也可以清空搜索查看全文。</p><button type="button" @click="query = ''">查看全部文档</button></div>
        <article v-for="section in visibleSections" :key="section.id" class="help-section">
          <h2 :id="section.id" tabindex="-1">{{ section.title }}</h2>
          <div class="help-prose" v-html="section.html"></div>
        </article>
      </main>
    </div>
  </div>
</template>

<style scoped>
.help-window{width:100%;min-width:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:#f7faf8;color:#24352d;font:14px/1.75 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}
.help-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:24px 34px 22px;border-bottom:1px solid #dce7e0;background:#fff}
.help-brand{font-size:11px;letter-spacing:.08em;font-weight:650;color:#427158}.help-header h1{margin:5px 0 3px;font-size:25px;font-weight:650}.help-header p{margin:0;color:#718077;font-size:13px}.help-badge{flex:none;padding:4px 12px;background:#eaf5ee;color:#316b49;border-radius:16px;font-size:12px}
.help-layout{display:grid;grid-template-columns:252px minmax(0,1fr);flex:1;min-height:0}.help-sidebar{display:flex;flex-direction:column;min-height:0;padding:23px 17px 16px;border-right:1px solid #dce7e0;background:#f3f7f4}.help-sidebar label{font-size:12px;font-weight:650;margin-bottom:7px}.help-search{display:flex;gap:6px}.help-search input{width:100%;min-width:0;padding:9px 10px;border:1px solid #c7d6cc;border-radius:7px;font:inherit;font-size:12px;background:#fff}.help-search button{flex:none;border:0;background:transparent;color:#286e49;cursor:pointer}.help-search-status{font-size:11px;color:#6a7e71;margin:8px 0 15px}.help-sidebar nav{overflow:auto;min-height:0;flex:1}.help-sidebar nav button{display:flex;align-items:baseline;gap:10px;width:100%;padding:9px 10px;margin:0 0 3px;text-align:left;border:0;border-radius:7px;color:#52685a;background:transparent;font:inherit;font-size:12px;cursor:pointer}.help-sidebar nav button span{color:#8a9b90;font-size:10px;font-variant-numeric:tabular-nums}.help-sidebar nav button:hover{background:#e7eee9}.help-sidebar nav button.active{background:#deede2;color:#225d3b;font-weight:650}.help-sidebar-note{font-size:11px;line-height:1.6;color:#7e8f83;border-top:1px solid #dce7e0;padding-top:12px;margin:12px 2px 0}
.help-reader{overflow:auto;min-width:0;padding:30px clamp(24px,4vw,58px) 60px;scroll-padding-top:24px}.help-section{max-width:860px;margin:0 auto 42px}.help-section>h2{margin:0 0 17px;padding-bottom:12px;border-bottom:1px solid #dce7e0;font-size:21px;font-weight:650;color:#244e36;scroll-margin-top:0}.help-section>h2:focus{outline:none}.help-prose :deep(h3){font-size:16px;margin:25px 0 10px;color:#315940}.help-prose :deep(p){margin:10px 0 14px}.help-prose :deep(ul),.help-prose :deep(ol){padding-left:22px;margin:10px 0 18px}.help-prose :deep(li){margin:6px 0}.help-prose :deep(code){padding:2px 5px;background:#e9f0eb;border-radius:4px;color:#295b3c;font:12px/1.65 Consolas,'Microsoft YaHei',monospace;overflow-wrap:anywhere}.help-prose :deep(pre){overflow:auto;padding:17px 20px;border:1px solid #dae5de;border-radius:9px;background:#eef4f0;line-height:1.7}.help-prose :deep(pre code){padding:0;background:transparent;overflow-wrap:normal;white-space:pre}.help-prose :deep(table){width:100%;border-collapse:collapse;font-size:12px;margin:16px 0 20px;table-layout:fixed}.help-prose :deep(th),.help-prose :deep(td){padding:10px 12px;border:1px solid #dce7e0;vertical-align:top;text-align:left;overflow-wrap:anywhere}.help-prose :deep(th){background:#eaf2ec;color:#32583f;font-weight:650}.help-prose :deep(blockquote){margin:16px 0;padding:1px 17px;border-left:3px solid #659b78;background:#edf5ef;color:#456750}.help-prose :deep(a){color:#2a7650}.help-empty{max-width:680px;margin:50px auto;color:#6c7e71}.help-empty button{padding:8px 16px;background:#286e49;color:#fff;border:0;border-radius:6px;cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #558d68;outline-offset:2px}
@media(max-width:850px){.help-layout{grid-template-columns:205px minmax(0,1fr)}.help-header{padding:20px 24px}.help-reader{padding:24px}.help-sidebar{padding:20px 12px}.help-prose :deep(th),.help-prose :deep(td){padding:8px}}
</style>
