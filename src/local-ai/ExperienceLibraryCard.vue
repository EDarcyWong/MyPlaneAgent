<script setup lang="ts">
import {computed,nextTick,onMounted,ref,watch} from 'vue'
import {Collection,Sunny,Document,Search,Refresh} from '@element-plus/icons-vue'
import {convertibleKind,recipeDetails,mismatchHints,failureLabels,type ExperienceEntry,type ExperienceRecipe,type ExperienceState} from '../../electron/shared/experience'
import type {AgentProject} from '../../electron/shared/local-ai-agent'
import type {SearchHealthRow} from '../../electron/main/agent/search-health'
const state=ref<ExperienceState>({enabled:false,entries:[]}),busy=ref(false),error=ref(''),expanded=ref(true)
const selected=ref(''),draft=ref<ExperienceRecipe>(),keywords=ref(''),projects=ref<AgentProject[]>([]),health=ref<SearchHealthRow[]>([])
const projectId=ref(''),network=ref(false),values=ref<Record<string,string>>({}),target=ref(0)
const query=ref(''),filter=ref('all'),panel=ref('overview')
const feedback=ref('')
const trialForm=ref<HTMLFormElement>()
const panels=[{id:'overview',label:'流程概览'},{id:'trial',label:'试运行'},{id:'edit',label:'适用条件'},{id:'history',label:'版本记录'}]
const reusable=(e:ExperienceEntry)=>!!e.enabled&&!!valid(e)
const flowIcon=(e:ExperienceEntry)=>e.intent==='weather'?Sunny:e.intent==='files'?Document:Search
const filtered=computed(()=>[...state.value.entries].reverse().filter(e=>(filter.value==='all'||(filter.value==='ready'?reusable(e):!valid(e)))&&[e.recipe?.title,...(e.recipe?.keywords||[]),e.tools.join(' ')].join(' ').toLowerCase().includes(query.value.trim().toLowerCase())))
const page=ref(1),pageSize=ref(5)
const listScroll=ref<HTMLElement>()
const pageCount=computed(()=>Math.max(1,Math.ceil(filtered.value.length/pageSize.value)))
const currentPage=computed(()=>Math.min(page.value,pageCount.value))
const pageEntries=computed(()=>filtered.value.slice((currentPage.value-1)*pageSize.value,currentPage.value*pageSize.value))
watch([query,filter,pageSize],()=>{page.value=1})
watch(pageCount,count=>{page.value=Math.min(page.value,count)})
watch([currentPage,query,filter,pageSize],()=>{if(listScroll.value)listScroll.value.scrollTop=0},{flush:'post'})
const entry=computed(()=>state.value.entries.find(e=>e.id===selected.value))
const details=computed(()=>draft.value?recipeDetails(draft.value):undefined)
const matchReasons=computed(()=>entry.value?.lastMatch?.revision===entry.value?.revision?entry.value?.lastMatch?.reasons||[]:[])
const valid=(e:ExperienceEntry)=>e.status==='verified'&&e.verification?.passed&&e.verification.revision===e.revision&&Date.parse(e.verification.expiresAt)>Date.now()
const status=(e:ExperienceEntry)=>e.recipe?.kind==='unsupported'?(convertibleKind(e)?'可转换':'仅记录'):valid(e)?'已验证':e.status==='verified'&&e.verification?.passed?'验证已过期':'待验证'
const date=(value?:string)=>value?new Date(value).toLocaleString():'尚无记录'
function select(id:string){feedback.value='';if(selected.value!==id)panel.value='overview';selected.value=id;const current=state.value.entries.find(e=>e.id===id);draft.value=current?.recipe?JSON.parse(JSON.stringify(current.recipe)):undefined;keywords.value=draft.value?.keywords.join('，')||'';values.value={};network.value=false;target.value=0}
async function perform(action:()=>Promise<ExperienceState>){busy.value=true;error.value='';feedback.value='';try{state.value=await action();select(state.value.entries.some(e=>e.id===selected.value)?selected.value:pageEntries.value[0]?.id||'')}catch(cause){error.value=String(cause)}finally{busy.value=false}}
async function refresh(){await perform(()=>window.myplane.localAiStudio('experienceState'));try{[projects.value,health.value]=await Promise.all([window.myplane.localAiStudio('agentProjects'),window.myplane.localAiStudio('experienceSearchHealth')])}catch(cause){error.value=String(cause)}}
const toggle=()=>perform(()=>window.myplane.localAiStudio('experienceConfigure',{enabled:!state.value.enabled}))
const remove=(id:string)=>perform(()=>window.myplane.localAiStudio('experienceRemove',{id}))
function save(){if(!entry.value||!draft.value)return;const current=entry.value,recipe={...JSON.parse(JSON.stringify(draft.value)),keywords:keywords.value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean)};return perform(()=>window.myplane.localAiStudio('experienceEdit',{id:current.id,revision:current.revision!,recipe}))}
async function enable(){
 if(!entry.value||busy.value)return
 const e=entry.value
 if(e.recipe?.kind==='unsupported'){
  if(!convertibleKind(e)){feedback.value='此工具组合尚无对应流程模板。';return}
  await perform(()=>window.myplane.localAiStudio('experienceConvert',{id:e.id,revision:e.revision!}))
  if(error.value)return
  const needsSource=entry.value?.recipe?.kind==='weather-web'&&!entry.value.recipe.sourceHost
  panel.value=needsSource?'edit':'trial';feedback.value=needsSource?'旧记录未保存成功来源，请填写当时有效的天气网站域名并保存，再试运行验证。':'已生成标准流程并保留原版本。请填写参数试运行，验证通过后即可启用。'
  await nextTick();trialForm.value?.querySelector<HTMLElement>('select,input')?.focus()
  return
 }
 if(!e.enabled&&!valid(e)){
  panel.value='trial';feedback.value='请填写本次参数并试运行，通过后即可启用。'
  await nextTick()
  trialForm.value?.querySelector<HTMLElement>('select,input')?.focus()
  return
 }
 await perform(()=>window.myplane.localAiStudio('experienceEnable',{id:e.id,revision:e.revision!,enabled:!e.enabled}))
 if(!error.value)feedback.value=e.enabled?'已停用此流程。':state.value.enabled?'已启用，后续符合条件的请求会自动复用。':'流程已启用；还需开启页面顶部的知识库总开关，才能自动复用。'
}
async function trial(){if(!entry.value)return;const e=entry.value,input={...values.value},consent=network.value,previousIssue=e.lastIssue?.at;await perform(()=>window.myplane.localAiStudio('experienceTrial',{id:e.id,revision:e.revision!,projectId:projectId.value||undefined,webEnabled:consent,values:input}));if(entry.value?.id===e.id&&(!entry.value.verification?.passed||entry.value.lastIssue?.at!==previousIssue)){values.value=input;network.value=consent}if(!error.value){const latest=entry.value;feedback.value=latest?.lastIssue&&latest.lastIssue.at!==previousIssue?failureLabels[latest.lastIssue.kind]:latest&&valid(latest)?'验证通过，请点击上方启用此流程。':'本次验证未通过，请查看原因并修正参数。'}}
function rollback(){if(!entry.value||!target.value)return;const e=entry.value;return perform(()=>window.myplane.localAiStudio('experienceRollback',{id:e.id,revision:e.revision!,target:target.value}))}
onMounted(refresh)
</script>
<template>
 <main class="experience-card" aria-label="知识库管理" :aria-busy="busy">
  <div class="experience-heading"><h1><span class="library-icon"><Collection aria-hidden="true"/></span>知识库</h1><button role="switch" aria-label="启用知识库" :aria-checked="state.enabled" :disabled="busy" @click="toggle"><span class="status-dot" aria-hidden="true"></span>{{state.enabled?'已启用':'已停用'}}</button><button class="refresh-button" :disabled="busy" @click="refresh"><Refresh aria-hidden="true"/>刷新</button><button :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起':'查看'}}记录（{{state.entries.length}}）</button></div>
  <p v-if="!state.enabled" class="notice">知识库已停用，暂停收集和自动复用；仍可查看与管理已有流程。</p>
  <p v-if="error" role="alert">{{error}}</p>
  <div v-if="expanded" class="experience-layout">
   <div class="experience-list">
    <div class="list-tools"><label class="search-label">查找流程<input v-model="query" type="search" placeholder="搜索名称、匹配词或工具" aria-label="搜索流程"></label><div class="list-filters" aria-label="流程状态筛选"><button v-for="option in [{id:'all',label:'全部'},{id:'ready',label:'可复用'},{id:'pending',label:'待验证'}]" :key="option.id" :aria-pressed="filter===option.id" @click="filter=option.id">{{option.label}}</button></div><small>{{filtered.length}} 个流程</small></div>
    <p v-if="!state.entries.length">暂无经验记录。完成一次天气查询、网页搜索并读取正文或文件查阅后，可在这里审阅流程。</p>
    <p v-else-if="!filtered.length" class="empty">没有匹配的流程，试试其他关键词或筛选条件。</p>
    <div ref="listScroll" class="page-items">
    <article v-for="item in pageEntries" :key="item.id" :class="{selected:item.id===selected}">
     <div><button class="entry-title" :disabled="busy" :aria-pressed="item.id===selected" @click="select(item.id)"><span class="flow-icon"><component :is="flowIcon(item)" aria-hidden="true"/></span>{{item.recipe?.title}}</button><div class="entry-meta"><span class="badge" :class="{good:valid(item)}">{{reusable(item)?'可复用':status(item)}}</span><p>版本 {{item.revision}} · 采用 {{item.uses||0}} 次</p></div><small>{{date(item.lastUsedAt)}}</small><div class="entry-actions"><button :disabled="busy" @click="select(item.id)">查看详情 →</button><button class="delete" :disabled="busy" aria-label="删除此经验记录" @click="remove(item.id)">删除</button></div></div>
    </article>
    </div>
    <nav v-if="filtered.length" class="list-pagination" aria-label="流程列表分页">
     <select v-model.number="pageSize" aria-label="每页条数" :disabled="busy"><option :value="5">5 条 / 页</option><option :value="10">10 条 / 页</option><option :value="20">20 条 / 页</option></select>
     <div><button aria-label="上一页" :disabled="busy||currentPage===1" @click="page=currentPage-1">‹</button><span aria-live="polite">{{currentPage}} / {{pageCount}}</span><button aria-label="下一页" :disabled="busy||currentPage===pageCount" @click="page=currentPage+1">›</button></div>
    </nav>
   </div>
   <section v-if="entry&&draft&&details" class="experience-detail" aria-label="流程详情">
    <h2><span class="flow-icon"><component :is="flowIcon(entry)" aria-hidden="true"/></span>{{entry.recipe?.title}} <small>v{{entry.revision}}</small></h2>
    <p class="detail-meta"><span class="badge" :class="{good:valid(entry)}">{{status(entry)}}</span><span v-if="entry.verification">验证到期 {{date(entry.verification.expiresAt)}}</span><span v-else>{{draft.kind==='unsupported'?(convertibleKind(entry)?'可生成标准流程':'暂无对应执行器'):'完成试运行后即可启用'}}</span></p>
    <p v-if="entry.verification&&!entry.verification.passed" class="validation-note">{{entry.verification.reason}}</p><p v-if="entry.lastIssue">最近运行：{{failureLabels[entry.lastIssue.kind]}}</p><p v-else-if="entry.lastFailure">最近失败：{{entry.lastFailure}}</p>
    <button :disabled="busy||(draft.kind==='unsupported'&&!convertibleKind(entry))" @click="enable">{{draft.kind==='unsupported'?(convertibleKind(entry)?'生成可验证流程':'暂不支持自动执行'):entry.enabled?'停用此流程':valid(entry)?'启用此流程':'先验证流程'}}</button>
    <p v-if="draft.kind==='unsupported'" class="action-help">{{convertibleKind(entry)?(convertibleKind(entry)==='weather-web'?'按有效天气网站建立查询方法，需先补充来源域名。':convertibleKind(entry)==='web-research'?'生成“搜索 → 读取正文”流程，需要搜索和网页读取工具。':convertibleKind(entry)==='file-read'?'生成“指定路径 → 读取文件”流程，试运行时选择原项目。':'生成天气查询流程。')+' 原记录保留，验证通过后可启用。':'尚未提炼出可复用的查询方法，暂不支持试运行或启用。'}}</p>
    <p v-if="feedback" role="status" class="action-help">{{feedback}}</p>
    <p v-if="entry.learning" class="action-help">自动提炼：{{entry.learning.reason}} <small>{{date(entry.learning.at)}}</small></p>
    <nav class="detail-tabs" aria-label="流程详情导航"><button v-for="tab in panels" :key="tab.id" :aria-current="panel===tab.id?'page':undefined" @click="panel=tab.id">{{tab.label}}<small v-if="tab.id==='history'"> {{entry.history?.length||0}}</small></button></nav>
    <div v-show="panel==='overview'" class="overview-panel">
    <p v-if="draft.kind==='weather-web'">优先来源：{{draft.sourceHost||'待补充'}} · 根据本次城市与日期查询最新预报</p>
    <p v-else-if="draft.kind==='weather'">优先来源：Open-Meteo · 直接查询并校验结构化天气数据</p>
    <div v-if="matchReasons.length" class="match-notice" aria-label="经验未采用原因"><strong>最近未采用的原因</strong><small>{{date(entry.lastMatch?.at)}}</small><ul><li v-for="code in matchReasons" :key="code"><span>{{mismatchHints[code].label}}</span><button v-if="mismatchHints[code].panel" :disabled="busy" @click="panel=mismatchHints[code].panel!">{{mismatchHints[code].action}} →</button><button v-else-if="code==='disabled'&&valid(entry)" :disabled="busy" @click="enable">启用此流程 →</button><button v-else-if="code==='library-off'&&!state.enabled" :disabled="busy" @click="toggle">开启知识库 →</button><small v-else>{{mismatchHints[code].action}}</small></li></ul></div>
    <p v-if="entry.interruptions">运行中断 {{entry.interruptions}} 次 · 校验 / 历史失败 {{entry.failures}} 次</p>
    <h3>执行步骤</h3><ul class="parameters"><li v-for="parameter in details.parameters" :key="parameter">{{parameter}}</li></ul><ol><li v-for="step in details.steps" :key="step">{{step}}</li></ol>
    <details class="validation-details"><summary>校验与失败处理</summary><ul><li v-for="check in details.checks" :key="check">{{check}}</li></ul><p>{{details.failure}}</p>
    <p>历史工具记录（仅供排查，不作为执行方法）：{{entry.tools.join(' → ')}}</p>
    <p v-if="entry.verification?.checks.length">最近通过检查：{{entry.verification.checks.join('；')}}</p></details>
    </div>
    <form v-show="panel==='edit'" class="experience-form" @submit.prevent="save">
     <h3>编辑适用条件</h3>
     <label>流程名称<input v-model="draft.title" maxlength="100" :disabled="busy" required></label>
     <label>匹配词（逗号分隔，全部满足）<input v-model="keywords" :disabled="busy" placeholder="例如 Vue、文档"></label>
     <label>地区（可多选；不选表示不限）<select v-model="draft.regions" multiple :disabled="busy"><option value="CN">中国大陆</option><option value="KR">韩国</option><option value="RU">俄罗斯</option><option value="GLOBAL">其他地区</option></select></label>
     <label>{{draft.kind==='weather-web'?'优先天气网站域名（必填）':'正文来源域名（可留空）'}}<input v-model="draft.sourceHost" :disabled="busy||draft.kind==='weather'" :required="draft.kind==='weather-web'" :placeholder="draft.kind==='weather-web'?'填写已确认有效的网站域名':'例如 vuejs.org'"></label>
     <label>验证有效期（小时）<input v-model.number="draft.ttlHours" type="number" min="1" max="720" :disabled="busy" required></label>
     <template v-if="draft.kind==='web-research'"><label>搜索结果上限<input v-model.number="draft.maxResults" type="number" min="1" max="5" :disabled="busy" required></label><label>正文字符上限<input v-model.number="draft.maxCharacters" type="number" min="1000" max="24000" :disabled="busy" required></label></template>
     <p>{{draft.kind==='weather-web'?'保存后需试运行。每次按本次城市和日期查询，不保存旧天气答案。':'保存后需重新验证。限定域名时，请同时设置匹配词。'}}</p><button :disabled="busy">保存为新版本</button>
    </form>
    <form v-if="draft.kind!=='unsupported'" v-show="panel==='trial'" ref="trialForm" class="experience-form" @submit.prevent="trial">
     <h3>试运行已保存版本</h3>
     <label>项目（文件流程须选择原项目）<select v-model="projectId" :disabled="busy" :required="draft.kind==='file-read'"><option value="">无项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{project.name}}</option></select></label>
     <template v-if="draft.kind==='weather'||draft.kind==='weather-web'"><label>城市<input v-model="values.city" :disabled="busy" required></label><label>日期<input v-model="values.day" :disabled="busy" placeholder="明天 或 YYYY-MM-DD" required></label></template>
     <label v-else-if="draft.kind==='file-read'">相对文件路径<input v-model="values.path" :disabled="busy" placeholder="README.md" required></label>
     <label v-else>查询词<input v-model="values.query" maxlength="300" :disabled="busy" required></label>
     <label v-if="draft.kind!=='weather'">预期正文片段（只用于本次核对）<input v-model="values.expectedText" maxlength="300" :disabled="busy" required></label>
     <label v-if="draft.kind!=='file-read'" class="check"><input v-model="network" type="checkbox" :disabled="busy">允许本次联网查询并读取页面；遵守项目联网设置</label>
     <p v-if="draft.kind!=='file-read'&&!network">请先勾选“允许本次联网”，才能开始试运行。</p>
     <p v-else-if="draft.kind==='file-read'&&!projectId">请选择产生此经验的原项目，再填写文件路径与预期正文片段。</p>
     <p v-else>使用已保存版本执行，验证通过后点击上方“启用此流程”。</p><button :disabled="busy||(draft.kind!=='file-read'&&!network)">{{busy?'处理中…':'试运行并验证'}}</button>
    </form>
    <div v-if="entry.history?.length" v-show="panel==='history'" class="experience-form"><h3>历史版本</h3><label>选择回退版本<select v-model.number="target" :disabled="busy"><option :value="0">请选择</option><option v-for="version in [...entry.history].reverse()" :key="version.revision" :value="version.revision">v{{version.revision}} · {{version.recipe.title}} · {{date(version.createdAt)}}</option></select></label><button :disabled="busy||!target" @click="rollback">恢复为新版本</button><p>保留最近 10 个历史版本，回退后需重新验证。</p></div>
    <p v-else-if="panel==='history'" class="empty">还没有历史版本。保存条件修改后，原版本会保留在这里。</p>
    <p v-if="panel==='trial'&&draft.kind==='unsupported'" class="empty">此工具序列暂不支持试运行，请在概览中查看已有记录。</p>
   </section>
  </div>
  <details class="search-health"><summary>搜索引擎近期表现 <small>{{health.length}} 条记录 · 24 小时有效</small></summary><p>连续两次无有效结果才降低地区组内优先级，成功后恢复。所有引擎保留重试机会，可用性不等于答案正确。</p><p v-if="!health.length">暂无有效期内的搜索记录。</p><div v-else class="table-scroll"><table><thead><tr><th>地区 / 引擎</th><th>有效结果 / 失败或空结果</th><th>状态</th><th>到期时间</th></tr></thead><tbody><tr v-for="row in health" :key="row.region+row.engine"><td>{{row.region}} / {{row.engine}}</td><td>{{row.successes}} / {{row.failures}}</td><td>{{row.deprioritized?'暂时后移':'默认顺序'}}</td><td>{{date(row.expiresAt)}}</td></tr></tbody></table></div></details>
 </main>
</template>






<style scoped>
.experience-card{padding:24px;flex:1;min-height:0;min-width:0;overflow:auto;color:var(--s-text);background:var(--s-panel);font-size:13px}.experience-card *{box-sizing:border-box}.experience-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:20px}.experience-heading h1{font-size:20px;margin:0 auto 0 0}.experience-card button,.experience-card input,.experience-card select{font:inherit;color:var(--s-text);background:var(--s-panel);border:1px solid var(--s-border);border-radius:6px;padding:7px 10px}.experience-card button{cursor:pointer}.experience-card button:disabled{opacity:.45;cursor:default}.experience-card :is(button,input,select,summary):focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}.experience-card p,.experience-card small{color:var(--s-dim);font-size:12px;line-height:1.65}.experience-card h2{font-size:17px;margin:0 0 8px}.experience-card h3{font-size:13px;margin:18px 0 12px}.experience-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;align-items:start}.list-tools{display:grid;gap:10px;margin-bottom:12px}.search-label{display:grid;gap:6px;font-size:12px;color:var(--s-dim)}.search-label input{width:100%}.list-filters{display:flex;gap:4px}.list-filters button{flex:1;border-color:transparent;font-size:12px;padding:5px}.list-filters button[aria-pressed=true]{background:color-mix(in srgb,var(--s-text) 6%,transparent);font-weight:600}.experience-list article{padding:14px 12px;border:1px solid transparent;border-bottom-color:var(--s-border);border-radius:6px;overflow-wrap:anywhere}.experience-list article.selected{background:color-mix(in srgb,var(--s-text) 3%,transparent);border-color:var(--s-border)}.experience-card .entry-title{display:block;font-weight:600;border:0;padding:0;text-align:left;background:transparent;margin-bottom:8px}.badge{font-size:11px;color:var(--s-dim)}.badge.good{color:var(--s-text)}.experience-list article p{margin:6px 0}.experience-list article small{display:none}.entry-actions{display:flex;justify-content:space-between;gap:8px;margin-top:10px}.experience-card .entry-actions button{border:0;background:transparent;padding:0;font-size:12px;color:var(--s-dim)}.entry-actions .delete:hover{color:#c44!important}.experience-detail{border:1px solid var(--s-border);border-radius:8px;padding:20px;min-width:0;overflow-wrap:anywhere}.experience-detail>p{margin:8px 0 12px}.experience-card button[aria-checked=true],.experience-detail>button,.experience-form>button{background:var(--s-accent);color:var(--s-on-accent)}.detail-tabs{display:flex;gap:20px;overflow:auto;border-bottom:1px solid var(--s-border);margin:18px 0 0}.experience-card .detail-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;padding:10px 0;white-space:nowrap;background:transparent;color:var(--s-dim)}.experience-card .detail-tabs button[aria-current]{border-bottom-color:var(--s-accent);color:var(--s-text)}.parameters{display:none}.experience-card ol{list-style:none;counter-reset:step;padding:0}.experience-card ol li{counter-increment:step;display:flex;gap:12px;margin:16px 0;line-height:1.7;font-size:12px}.experience-card ol li:before{content:counter(step,decimal-leading-zero);color:var(--s-dim);flex-shrink:0}.validation-details{border-top:1px solid var(--s-border);padding-top:14px;margin-top:20px}.experience-card summary{cursor:pointer;font-size:12px;color:var(--s-dim)}.validation-details li{font-size:12px;line-height:1.8}.experience-form label{display:flex;flex-direction:column;gap:7px;font-size:12px;margin:14px 0}.experience-form input,.experience-form select{width:100%;padding:9px 10px}.experience-form .check{flex-direction:row;align-items:center}.experience-form .check input{width:auto}.experience-form>button{margin-top:8px}.search-health{border-top:1px solid var(--s-border);padding:16px 0;margin-top:24px}.search-health summary small{margin-left:10px}.table-scroll{overflow:auto}.search-health table{border-collapse:collapse;font-size:12px;width:100%}.search-health td,.search-health th{padding:10px;text-align:left;border-bottom:1px solid var(--s-border)}.empty,.notice{padding:16px;background:color-mix(in srgb,var(--s-text) 3%,transparent);border-radius:6px}[role=alert]{color:#c44!important}@media(max-width:1050px){.experience-card{padding:18px}.experience-layout{grid-template-columns:210px minmax(0,1fr);gap:16px}.detail-tabs{gap:14px}}@media(max-width:820px){.experience-layout{grid-template-columns:1fr}.experience-list{max-height:300px;overflow:auto}.experience-heading h1{width:100%;margin-bottom:8px}.experience-detail{padding:16px}}
</style>
<style scoped>
.experience-card{--library-ink:color-mix(in srgb,#438d83 72%,var(--s-text));--library-soft:color-mix(in srgb,#438d83 9%,var(--s-panel));padding:30px;background:color-mix(in srgb,var(--s-muted) 65%,var(--s-panel));font-family:inherit}.experience-heading{margin-bottom:26px;gap:10px}.experience-heading h1{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:650;letter-spacing:-.5px}.library-icon{width:40px;height:40px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--library-ink) 18%,var(--s-border));border-radius:12px;background:var(--s-panel);color:var(--library-ink);box-shadow:0 3px 8px #00000005}.library-icon svg{width:22px;height:22px}.experience-card button{transition:background .15s,border-color .15s,box-shadow .15s}.experience-card button:hover:not(:disabled){border-color:color-mix(in srgb,var(--s-text) 22%,var(--s-border));background:var(--s-muted)}.experience-heading>button{height:34px;padding:6px 12px;font-size:12px;border-radius:8px}.experience-heading button[role=switch]{display:flex;align-items:center;gap:7px;background:var(--s-panel);color:var(--s-dim)}.experience-heading button[aria-checked=true]{background:var(--library-soft);border-color:color-mix(in srgb,var(--library-ink) 20%,var(--s-border));color:var(--library-ink)}.status-dot{width:6px;height:6px;border-radius:50%;background:currentColor}.refresh-button{display:flex;align-items:center;gap:6px}.refresh-button svg{width:14px;height:14px}.experience-layout{grid-template-columns:260px minmax(0,1fr);gap:22px}.list-tools{gap:12px;margin-bottom:14px}.search-label{font-weight:500;gap:8px}.search-label input{height:38px;border-radius:9px;font-weight:400;box-shadow:0 1px 2px #00000002}.list-filters{background:color-mix(in srgb,var(--s-text) 5%,transparent);border-radius:8px;padding:3px;gap:2px}.list-filters button{padding:6px 4px;border-radius:6px}.list-filters button[aria-pressed=true]{background:var(--s-panel);box-shadow:0 1px 4px #00000008;color:var(--library-ink)}.list-tools>small{font-size:11px;padding-left:2px}.experience-list article{background:var(--s-panel);border:1px solid var(--s-border);border-radius:10px;padding:10px 12px;margin-bottom:8px;box-shadow:0 2px 5px #00000002}.experience-list article.selected{background:var(--s-panel);border-color:color-mix(in srgb,var(--library-ink) 50%,var(--s-border));box-shadow:inset 3px 0 var(--library-ink),0 3px 10px #00000004}.experience-card .entry-title{display:flex;align-items:center;gap:10px;font-size:13px;line-height:1.5;margin-bottom:8px}.flow-icon{width:30px;height:30px;display:inline-grid;place-items:center;border-radius:8px;background:var(--library-soft);color:var(--library-ink);flex-shrink:0}.flow-icon svg{width:17px;height:17px}.badge{display:inline-flex;align-items:center;gap:5px;border-radius:5px;padding:2px 7px;background:color-mix(in srgb,#c29148 11%,var(--s-panel));color:color-mix(in srgb,#a17229 70%,var(--s-text));font-size:11px;line-height:1.7}.badge:before{content:'';width:4px;height:4px;border-radius:50%;background:currentColor}.badge.good{background:var(--library-soft);color:var(--library-ink)}.experience-list article p{font-size:11px;margin:0}.entry-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}.experience-list .flow-icon{width:26px;height:26px}.experience-list .flow-icon svg{width:15px;height:15px}.entry-actions{border-top:1px solid var(--s-border);padding-top:6px;margin-top:8px}.entry-actions button:first-child{color:var(--library-ink)!important}.experience-detail{background:var(--s-panel);border-radius:13px;padding:26px;box-shadow:0 4px 18px #00000003}.experience-detail>h2{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:600;letter-spacing:-.2px}.experience-detail>h2 .flow-icon{width:36px;height:36px;border-radius:10px}.experience-detail>h2 small{font-size:11px;font-weight:400;background:var(--s-muted);border-radius:5px;padding:2px 7px;margin-left:2px}.detail-meta{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:14px 0 18px!important}.experience-detail>button,.experience-form>button{padding:8px 16px;border-radius:7px;font-size:12px}.experience-detail>button:disabled{background:var(--s-muted);border-color:var(--s-border);color:var(--s-dim);opacity:1}.detail-tabs{gap:24px;margin-top:24px}.experience-card .detail-tabs button{font-size:12px;padding:12px 1px;border-bottom-width:2px}.experience-card .detail-tabs button[aria-current]{color:var(--library-ink);border-bottom-color:var(--library-ink);font-weight:600}.detail-tabs small{display:inline-block;background:var(--s-muted);min-width:17px;text-align:center;border-radius:4px;margin-left:4px;font-size:10px}.overview-panel h3{font-size:12px;color:var(--s-dim);font-weight:500;margin-top:22px}.experience-card ol{margin:18px 0 24px}.experience-card ol li{position:relative;align-items:center;margin:0;padding:0 0 22px;gap:14px;font-size:12px;min-height:48px}.experience-card ol li:last-child{padding-bottom:0;min-height:28px}.experience-card ol li:before{position:relative;z-index:1;background:var(--library-soft);color:var(--library-ink);border:1px solid color-mix(in srgb,var(--library-ink) 14%,var(--s-border));width:27px;height:27px;display:grid;place-items:center;border-radius:50%;font-size:10px;font-weight:600}.experience-card ol li:not(:last-child):after{content:'';position:absolute;left:13px;top:27px;bottom:0;border-left:1px dashed color-mix(in srgb,var(--library-ink) 25%,var(--s-border))}.validation-details{border-top:0;background:var(--s-muted);padding:12px 14px;border-radius:8px;margin-top:20px}.validation-details summary{color:var(--s-dim)}.experience-form{max-width:680px}.experience-form label{margin:18px 0;gap:8px}.experience-form input,.experience-form select{border-radius:8px;background:color-mix(in srgb,var(--s-muted) 28%,var(--s-panel))}.experience-form input:focus,.experience-form select:focus{background:var(--s-panel)}.search-health{border:1px solid var(--s-border);border-radius:10px;background:var(--s-panel);padding:15px 18px;margin-top:20px}.search-health summary small{font-size:11px}.experience-card :is(button,input,select,summary):focus-visible{outline-color:var(--library-ink)}@media(max-width:1100px){.experience-card{padding:22px}.experience-layout{grid-template-columns:230px minmax(0,1fr);gap:16px}.experience-detail{padding:20px}.detail-tabs{gap:16px}}@media(max-width:820px){.experience-layout{grid-template-columns:1fr}.experience-heading{gap:8px}.experience-heading h1{font-size:20px}.experience-list{max-height:320px}.experience-detail{padding:18px}}@media(prefers-reduced-motion:reduce){.experience-card button{transition:none}}
</style>

<style scoped>.match-notice{margin-top:18px;padding:12px 14px;border:1px solid var(--s-border);border-radius:8px;font-size:12px}.match-notice>small{display:block;margin-top:4px}.match-notice ul{padding:0;list-style:none;margin:12px 0 0}.match-notice li{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;margin:8px 0}.match-notice li>span{font-weight:500}.match-notice button{border:0;background:transparent;padding:0;color:var(--library-ink);font-size:12px}</style>

<style scoped>
.experience-list{display:flex;flex-direction:column;max-height:calc(100dvh - 260px);min-height:260px}.list-tools,.list-pagination{flex-shrink:0}.page-items{min-height:0;overflow:auto;scrollbar-width:thin;padding:1px}.list-pagination{display:flex;align-items:center;justify-content:space-between;gap:6px;padding-top:12px;border-top:1px solid var(--s-border)}.experience-card .list-pagination select{font-size:11px;padding:5px 6px;min-width:0}.list-pagination>div{display:flex;align-items:center;gap:7px}.experience-card .list-pagination button{padding:2px 9px;font-size:18px;line-height:24px}.list-pagination span{font-size:11px;color:var(--s-dim);white-space:nowrap;font-variant-numeric:tabular-nums}@media(max-width:820px){.experience-list{max-height:none;min-height:0;overflow:visible}.page-items{max-height:280px}}
</style>



