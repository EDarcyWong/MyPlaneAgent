<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Connection, Plus, Refresh, Close } from '@element-plus/icons-vue'
import type { AgentCoreCommands } from '../../electron/shared/local-ai-studio'

type Server = AgentCoreCommands['agentCoreMcpList']['output'][number]
type Capability = AgentCoreCommands['agentCoreListCapabilities']['output'][number]
const servers = ref<Server[]>([])
const capabilities = ref<Capability[]>([])
const name = ref('')
const id = ref('')
const command = ref('')
const argumentsText = ref('')
const action = ref('')
const error = ref('')
const notice = ref('')
const loaded = ref(false)
const showForm = ref(false)
const removeId = ref('')
const search = ref('')
const busy = computed(() => !!action.value)
const connectedCount = computed(() => servers.value.filter(server => server.connected).length)
const filtered = computed(() => servers.value.filter(server => `${server.name} ${server.id} ${server.command}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const toolsFor = (server: Server) => server.connected ? capabilities.value.filter(tool => tool.source === 'mcp' && tool.name.startsWith(`mcp.${server.id}.`)) : []
const argumentsList = computed(() => argumentsText.value.split(/\r?\n/).filter(item => item.trim().length > 0))
const validation = computed(() => {
  if (!name.value.trim()) return '填写一个便于识别的服务名称。'
  if (!command.value.trim()) return '填写启动程序的完整路径。'
  if (!/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(command.value.trim())) return '启动程序需要使用绝对路径。'
  if (id.value && !/^[a-z][a-z0-9-]*$/.test(id.value)) return '服务标识须以小写字母开头，只能包含小写字母、数字和连字符。'
  if (id.value && servers.value.some(server => server.id === id.value)) return '该服务标识已存在。'
  if (argumentsList.value.length > 50 || argumentsList.value.some(item => item.length > 4000)) return '最多填写 50 个参数，每个参数不超过 4000 个字符。'
  return ''
})
async function load() {
  const [list, tools] = await Promise.all([
    window.myplane.localAiStudio('agentCoreMcpList'), window.myplane.localAiStudio('agentCoreListCapabilities')
  ])
  servers.value = list; capabilities.value = tools; loaded.value = true
}
async function refresh() {
  if (busy.value) return
  action.value = 'refresh'; error.value = ''; notice.value = ''
  try { await load() } catch (cause) { error.value = String(cause) }
  finally { action.value = '' }
}
async function add() {
  if (busy.value || validation.value) return
  action.value = 'add'; error.value = ''; notice.value = ''
  // Keep the generated identifier on failed attempts, so retries target the same configuration.
  if (!id.value) id.value = `server-${crypto.randomUUID().slice(0, 8)}`
  try {
    await window.myplane.localAiStudio('agentCoreMcpAdd', {
      id: id.value, name: name.value.trim(), command: command.value.trim(), args: argumentsList.value
    })
    notice.value = `已连接并保存“${name.value.trim()}”。`
    id.value = ''; name.value = ''; command.value = ''; argumentsText.value = ''; showForm.value = false
    await load()
  } catch (cause) { error.value = String(cause) }
  finally { action.value = '' }
}
async function operate(server: Server, operation: 'connect' | 'disconnect' | 'remove') {
  if (busy.value) return
  action.value = `${operation}:${server.id}`; error.value = ''; notice.value = ''
  try {
    const commands = { connect: 'agentCoreMcpConnect', disconnect: 'agentCoreMcpDisconnect', remove: 'agentCoreMcpRemove' } as const
    await window.myplane.localAiStudio(commands[operation], { id: server.id })
    notice.value = operation === 'disconnect' ? `已断开“${server.name}”，配置已保留；下次启动应用时会自动连接。` : operation === 'remove' ? `已移除“${server.name}”。` : `已连接“${server.name}”。`
    removeId.value = ''
    await load()
  } catch (cause) { error.value = String(cause) }
  finally { action.value = '' }
}
onMounted(refresh)
</script>

<template>
  <main class="core-mcp">
    <div class="mcp-content">
      <header class="mcp-header"><div><span class="mcp-eyebrow">工具与扩展</span><h1>MCP 服务</h1><p>连接外部工具，让 Agent 能查询数据、访问应用和执行更多操作。</p></div><button class="mcp-primary" :disabled="busy || showForm" @click="showForm=true"><Plus/>添加服务</button></header>
      <div class="mcp-intro"><Connection/><div><strong>通过本机程序连接</strong><p>目前支持本机 MCP 程序（stdio）。连接成功后，服务提供的工具会自动供 Agent 使用。已保存的服务会在应用启动时自动连接。</p></div></div>
      <p v-if="error" class="mcp-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="mcp-notice" role="status">{{ notice }}</p>
      <form v-if="showForm" class="mcp-card mcp-form" @submit.prevent="add">
        <div class="mcp-section-heading"><h2>添加服务</h2><button type="button" class="mcp-icon-button" aria-label="收起添加表单" :disabled="busy" @click="showForm=false"><Close/></button></div>
        <label>服务名称<input v-model="name" :disabled="busy" required maxlength="80" placeholder="例如：项目文件工具" autofocus></label>
        <label>启动程序<input v-model="command" :disabled="busy" required maxlength="2000" placeholder="例如：/usr/local/bin/node"><small>填写可执行文件的完整路径，启动参数单独填写在下方。</small></label>
        <label>启动参数 <span class="mcp-optional">选填</span><textarea v-model="argumentsText" :disabled="busy" rows="3" placeholder="/path/to/server.mjs&#10;/path/to/workspace"></textarea><small>每行一个参数。含空格的路径也写在一行，无需额外加引号。</small></label>
        <details><summary>高级设置</summary><label>服务标识<input v-model="id" :disabled="busy" maxlength="64" pattern="[a-z][a-z0-9-]*" placeholder="留空则自动生成"><small>用于区分工具来源，保存后不可修改。</small></label></details>
        <footer><span>{{ validation || '连接成功后保存配置，失败时保留当前输入。' }}</span><button type="button" :disabled="busy" @click="showForm=false">收起</button><button class="mcp-primary" type="submit" :disabled="busy || !!validation">{{ action === 'add' ? '正在连接…' : '连接并保存' }}</button></footer>
      </form>
      <section class="mcp-services" aria-label="已保存服务">
        <div class="mcp-section-heading"><h2>已保存服务 <small v-if="loaded">{{ servers.length }} 个 · {{ connectedCount }} 个已连接</small></h2><button :disabled="busy" @click="refresh"><Refresh :class="{spinning:action==='refresh'}"/>{{ action === 'refresh' ? '刷新中…' : '刷新' }}</button></div>
        <input v-if="servers.length" v-model="search" class="mcp-search" type="search" aria-label="搜索 MCP 服务" placeholder="搜索名称、标识或启动程序">
        <div v-if="!loaded" class="mcp-empty"><p>{{ busy ? '正在读取服务…' : '暂时无法读取服务，请点击刷新重试。' }}</p></div>
        <div v-else-if="!servers.length" class="mcp-empty"><Connection/><h3>尚未添加外部工具</h3><p>有 MCP 程序时，可在这里连接。已有的插件工具可以照常使用。</p><button v-if="!showForm" :disabled="busy" @click="showForm=true">添加第一个服务</button></div>
        <p v-else-if="!filtered.length" class="mcp-empty">没有匹配的服务，试试其他关键词。</p>
        <article v-for="server in filtered" :key="server.id" class="mcp-card">
          <header class="mcp-server-heading"><div class="mcp-server-title"><span class="mcp-server-icon"><Connection/></span><div><h3>{{ server.name }}</h3><small>{{ server.id }}</small></div></div><span class="mcp-status" :class="{connected:server.connected}">{{ action === `connect:${server.id}` ? '正在连接…' : action === `disconnect:${server.id}` ? '正在断开…' : server.connected ? '已连接' : '未连接' }}</span></header>
          <details class="mcp-config"><summary>启动配置</summary><dl><dt>启动程序</dt><dd><code>{{ server.command }}</code></dd><dt>参数</dt><dd><pre>{{ server.args.length ? server.args.join('\n') : '无' }}</pre></dd></dl></details>
          <details v-if="server.connected && toolsFor(server).length" class="mcp-tools"><summary>{{ toolsFor(server).length }} 个可用工具</summary><ul><li v-for="tool in toolsFor(server)" :key="tool.name"><code>{{ tool.name.slice(`mcp.${server.id}.`.length) }}</code><p>{{ tool.description || '暂无说明' }}</p></li></ul></details>
          <p v-else class="mcp-muted">{{ server.connected ? '服务已连接，但尚未提供可用工具。' : '连接后可查看并使用此服务提供的工具。' }}</p>
          <footer v-if="removeId !== server.id"><span class="mcp-muted">{{ server.connected ? '断开仅对本次运行生效' : '配置已保留，可重新连接' }}</span><button v-if="server.connected" :disabled="busy" @click="operate(server,'disconnect')">{{ action === `disconnect:${server.id}` ? '正在断开…' : '断开连接' }}</button><button v-else class="mcp-primary" :disabled="busy" @click="operate(server,'connect')">{{ action === `connect:${server.id}` ? '正在连接…' : '连接' }}</button><button :disabled="busy" @click="removeId=server.id">移除</button></footer>
          <footer v-else class="mcp-remove"><span>移除后将断开连接并删除此配置。</span><button :disabled="busy" @click="removeId=''">取消</button><button class="mcp-danger" :disabled="busy" @click="operate(server,'remove')">{{ action === `remove:${server.id}` ? '正在移除…' : '确认移除' }}</button></footer>
        </article>
      </section>
    </div>
  </main>
</template>

<style scoped>
.core-mcp{height:100%;min-height:0;overflow:auto;background:var(--s-bg);color:var(--s-text);font-size:13px;container-type:inline-size}.mcp-content{max-width:960px;margin:auto;padding:32px 32px 48px}.core-mcp *{box-sizing:border-box}.core-mcp svg{width:16px;height:16px;flex:none}.core-mcp button,.core-mcp input,.core-mcp textarea{font:inherit;color:inherit}.core-mcp button{display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;border:1px solid var(--s-border);border-radius:7px;background:var(--s-panel);padding:8px 12px;white-space:nowrap}.core-mcp button:hover:not(:disabled){background:var(--s-muted)}.core-mcp button.mcp-primary{background:var(--s-accent);color:var(--s-on-accent);border-color:transparent}.core-mcp button.mcp-danger{color:var(--s-danger)}.core-mcp :disabled{opacity:.5;cursor:default}.core-mcp :focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}.mcp-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}.mcp-eyebrow{font-size:11px;color:var(--s-dim)}.mcp-header h1{font-size:25px;margin:8px 0;letter-spacing:-.5px}.mcp-header p{color:var(--s-dim);line-height:1.8;margin:0}.mcp-intro{display:flex;gap:12px;padding:16px;border-radius:9px;background:var(--s-muted);line-height:1.7}.mcp-intro>svg{margin-top:3px}.mcp-intro strong{font-size:12px;font-weight:550}.mcp-intro p{margin:4px 0 0;color:var(--s-dim);font-size:12px}.mcp-card{border:1px solid var(--s-border);border-radius:11px;padding:20px;margin-top:14px;background:var(--s-panel);min-width:0}.mcp-services{margin-top:26px}.mcp-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.mcp-section-heading h2{font-size:14px;margin:0;font-weight:600}.mcp-section-heading h2 small{font-size:11px;font-weight:400;color:var(--s-dim);margin-left:8px}.mcp-form label{display:block;font-size:12px;font-weight:500;margin-top:17px}.core-mcp input,.core-mcp textarea{display:block;width:100%;min-width:0;padding:10px 12px;border:1px solid var(--s-border);border-radius:7px;background:var(--s-bg);margin-top:8px}.core-mcp textarea{resize:vertical;line-height:1.7}.core-mcp input::placeholder,.core-mcp textarea::placeholder{color:var(--s-dim)}.mcp-form small{display:block;font-weight:400;color:var(--s-dim);font-size:11px;margin-top:6px;line-height:1.6}.mcp-optional{font-weight:400;color:var(--s-dim);font-size:11px;margin-left:4px}.mcp-form details{margin-top:18px}.core-mcp summary{font-size:12px;color:var(--s-dim);cursor:pointer}.core-mcp footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:18px}.core-mcp footer>span{flex:1;font-size:11px;line-height:1.7;color:var(--s-dim)}.core-mcp button.mcp-icon-button{border:0;padding:5px;background:transparent}.mcp-server-heading{display:flex;justify-content:space-between;align-items:center;gap:14px}.mcp-server-title{display:flex;gap:10px;align-items:center;min-width:0}.mcp-server-title>div{min-width:0}.mcp-server-title h3{font-size:14px;margin:0 0 4px;overflow-wrap:anywhere}.mcp-server-title small{font-size:11px;color:var(--s-dim);overflow-wrap:anywhere}.mcp-server-icon{display:grid;place-items:center;width:34px;height:34px;flex:none;background:var(--s-muted);border-radius:8px}.mcp-status{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--s-dim);white-space:nowrap}.mcp-status:before{content:'';width:6px;height:6px;background:var(--s-dim);border-radius:50%}.mcp-status.connected:before{background:#4a9b72}.mcp-config,.mcp-tools{margin-top:18px}.mcp-config dl{display:grid;grid-template-columns:64px minmax(0,1fr);gap:10px;font-size:12px;background:var(--s-bg);border-radius:7px;padding:12px}.mcp-config dt{color:var(--s-dim)}.mcp-config dd{margin:0;overflow-wrap:anywhere}.mcp-config pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.mcp-tools ul{list-style:none;padding:0;margin:12px 0;max-height:280px;overflow:auto}.mcp-tools li{padding:10px 0;border-top:1px solid var(--s-border)}.mcp-tools code{font-size:12px;overflow-wrap:anywhere}.mcp-tools p,.mcp-muted{font-size:12px;color:var(--s-dim);line-height:1.7;overflow-wrap:anywhere}.mcp-tools p{margin:5px 0 0}.mcp-empty{text-align:center;padding:32px 16px;color:var(--s-dim);line-height:1.8;font-size:12px}.mcp-empty>svg{width:28px;height:28px;margin-bottom:8px}.mcp-empty h3{font-size:14px;font-weight:500;color:var(--s-text);margin:0}.mcp-empty p{margin:8px 0 16px}.mcp-error,.mcp-notice{padding:12px 14px;border-radius:8px;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--s-muted)}.mcp-error{color:var(--s-danger)}.mcp-notice{color:var(--s-text)}.mcp-remove{border-top:1px solid var(--s-border);padding-top:14px}.spinning{animation:mcp-spin 1s linear infinite}@keyframes mcp-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}@container(max-width:560px){.mcp-content{padding:20px 16px 32px}.mcp-header{flex-wrap:wrap}.mcp-card{padding:16px}.core-mcp footer{flex-wrap:wrap}.core-mcp footer>span{flex-basis:100%}.mcp-section-heading h2 small{display:block;margin:5px 0 0}}
</style>
