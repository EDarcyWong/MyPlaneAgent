<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { helpDocuments } from './help-documents'
import type { StudioSettings } from '../../electron/shared/local-ai-studio'

const props = defineProps<{ documentId?: string; appearanceStyle?: StudioSettings['appearanceStyle']; theme?: StudioSettings['theme'] }>()
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
  <div class="help-window" :data-style="appearanceStyle||'minimal'" :data-theme="theme||'system'">
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
.help-window{--h-bg:#f7faf8;--h-panel:#fff;--h-muted:#eef4f0;--h-rail:#f3f7f4;--h-border:#dce7e0;--h-text:#24352d;--h-dim:#718077;--h-accent:#286e49;--h-soft:#deede2;background:var(--h-bg);color:var(--h-text)}
.help-window[data-style=ocean]{--h-bg:#f2f7fb;--h-panel:#fff;--h-muted:#e7f1f8;--h-rail:#e5f0f8;--h-border:#cbdde9;--h-text:#18334b;--h-dim:#60798c;--h-accent:#176fa6;--h-soft:#dceefa}
.help-window[data-style=paper]{--h-bg:#f7f3eb;--h-panel:#fffcf6;--h-muted:#efe8da;--h-rail:#eee6d7;--h-border:#ddd1be;--h-text:#3f352b;--h-dim:#7a6a58;--h-accent:#9b5e36;--h-soft:#f4e3d2;font-family:'Iowan Old Style','Avenir Next',-apple-system,'PingFang SC',serif}
.help-window[data-style=terminal]{--h-bg:#f0f5f3;--h-panel:#fbfefc;--h-muted:#e3eee9;--h-rail:#dcebe5;--h-border:#b9d3c7;--h-text:#1b3731;--h-dim:#5b776d;--h-accent:#087a67;--h-soft:#d3eee4;font-family:'SFMono-Regular','Cascadia Code',Consolas,'PingFang SC',monospace}
.help-window[data-theme=dark]{--h-bg:#202020;--h-panel:#272727;--h-muted:#333;--h-rail:#191919;--h-border:#444;--h-text:#ececec;--h-dim:#adadad;--h-accent:#a4e3c0;--h-soft:#32443a;color-scheme:dark}
.help-window[data-style=ocean][data-theme=dark]{--h-bg:#101d2a;--h-panel:#192b3b;--h-muted:#223a4d;--h-rail:#122536;--h-border:#38566c;--h-text:#e7f4fb;--h-dim:#a9c1d0;--h-accent:#7bc5ed;--h-soft:#24445a}
.help-window[data-style=paper][data-theme=dark]{--h-bg:#28241f;--h-panel:#332d26;--h-muted:#40382d;--h-rail:#242019;--h-border:#60513f;--h-text:#f7eddb;--h-dim:#c9b9a2;--h-accent:#e3ad79;--h-soft:#57402d}
.help-window[data-style=terminal][data-theme=dark]{--h-bg:#0d1720;--h-panel:#15232e;--h-muted:#203340;--h-rail:#101e27;--h-border:#35525a;--h-text:#e3f0ec;--h-dim:#a6c1b9;--h-accent:#66ddbb;--h-soft:#1d4644}
@media(prefers-color-scheme:dark){
 .help-window[data-theme=system]{--h-bg:#202020;--h-panel:#272727;--h-muted:#333;--h-rail:#191919;--h-border:#444;--h-text:#ececec;--h-dim:#adadad;--h-accent:#a4e3c0;--h-soft:#32443a;color-scheme:dark}
 .help-window[data-style=ocean][data-theme=system]{--h-bg:#101d2a;--h-panel:#192b3b;--h-muted:#223a4d;--h-rail:#122536;--h-border:#38566c;--h-text:#e7f4fb;--h-dim:#a9c1d0;--h-accent:#7bc5ed;--h-soft:#24445a}
 .help-window[data-style=paper][data-theme=system]{--h-bg:#28241f;--h-panel:#332d26;--h-muted:#40382d;--h-rail:#242019;--h-border:#60513f;--h-text:#f7eddb;--h-dim:#c9b9a2;--h-accent:#e3ad79;--h-soft:#57402d}
 .help-window[data-style=terminal][data-theme=system]{--h-bg:#0d1720;--h-panel:#15232e;--h-muted:#203340;--h-rail:#101e27;--h-border:#35525a;--h-text:#e3f0ec;--h-dim:#a6c1b9;--h-accent:#66ddbb;--h-soft:#1d4644}
}
.help-window .help-header{border-color:var(--h-border);background:var(--h-panel)}
.help-window :is(.help-brand,.help-section>h2,.help-prose :deep(h3),.help-prose :deep(a)){color:var(--h-accent)}
.help-window :is(.help-header p,.help-search-status,.help-sidebar-note,.help-empty){color:var(--h-dim)}
.help-window .help-badge{background:var(--h-soft);color:var(--h-accent)}
.help-window .help-sidebar{border-color:var(--h-border);background:var(--h-rail)}
.help-window .help-search input{border-color:var(--h-border);background:var(--h-panel);color:var(--h-text)}
.help-window .help-search button{color:var(--h-accent)}
.help-window .help-sidebar nav button{color:var(--h-text)}
.help-window .help-sidebar nav button span{color:var(--h-dim)}
.help-window .help-sidebar nav button:hover{background:var(--h-muted)}
.help-window .help-sidebar nav button.active{background:var(--h-soft);color:var(--h-accent)}
.help-window :is(.help-sidebar-note,.help-section>h2,.help-prose :deep(th),.help-prose :deep(td)){border-color:var(--h-border)}
.help-window .help-prose :deep(code){background:var(--h-muted);color:var(--h-accent)}
.help-window .help-prose :deep(pre){border-color:var(--h-border);background:var(--h-muted)}
.help-window .help-prose :deep(th){background:var(--h-soft);color:var(--h-accent)}
.help-window .help-prose :deep(blockquote){border-color:var(--h-accent);background:var(--h-muted);color:var(--h-text)}
.help-window .help-empty button{background:var(--h-accent);color:var(--h-panel)}
.help-window :is(button,input):focus-visible{outline-color:var(--h-accent)}
</style>
