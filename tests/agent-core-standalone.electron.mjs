import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myplane-core-smoke-'))
process.env.MYPLANE_AGENT_DATA_DIR = root
process.env.MYPLANE_AGENT_TEST_MODE = '1'
app.setAppPath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const watchdog = setTimeout(() => {
  console.error('Agent Core smoke timed out while starting Electron')
  fs.rmSync(root, { recursive: true, force: true })
  process.exit(1)
}, 30000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, label) {
  const deadline = Date.now() + 15000
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await delay(50)
  }
}

// Let Electron finish loading this module before waiting for app readiness.
async function main() {
try {
  await import('../dist-electron/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length > 0, 'main window')
  const window = BrowserWindow.getAllWindows()[0]
  const evaluate = source => window.webContents.executeJavaScript(source, true)
  const navigate = async label => {
    const visible = await evaluate(`[...document.querySelectorAll('.settings-rail-button')].some(button => button.getAttribute('aria-label') === ${JSON.stringify(label)})`)
    if (visible) return evaluate(`[...document.querySelectorAll('.settings-rail-button')].find(button => button.getAttribute('aria-label') === ${JSON.stringify(label)}).click()`)
    if (!await evaluate("document.querySelector('.settings-more-trigger').getAttribute('aria-expanded') === 'true'"))
      await evaluate("document.querySelector('.settings-more-trigger').click()")
    await until(() => evaluate(`[...document.querySelectorAll('.settings-more-menu button')].some(button => button.textContent.trim() === ${JSON.stringify(label)})`), `${label} menu item`)
    await evaluate(`[...document.querySelectorAll('.settings-more-menu button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`)
  }
  await until(() => !window.webContents.isLoading(), 'renderer')
  await until(() => evaluate("!!document.querySelector('.chat-workbench')"), 'chat workspace')
  assert.equal(await evaluate("document.querySelector('.settings-feature-list button:first-child')?.getAttribute('aria-label')"), '会话')
  assert.equal(await evaluate("document.querySelector('.settings-navigation').getBoundingClientRect().width <= 60"), true)
  assert.equal(await evaluate("document.querySelectorAll('.settings-feature-list>.settings-rail-button').length"), 4)
  assert.equal(await evaluate("!!document.querySelector('.chat-settings-button')"), false)
  await navigate('应用设置')
  await until(() => evaluate("!!document.querySelector('.settings-more-trigger.active')"), 'settings navigation')
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Agent Core\"]')"), false)
  assert.equal(await evaluate("!!document.querySelector('.core-workbench')"), false)
  const status = await evaluate("window.myplane.localAiStudio('agentCoreStatus')")
  assert.equal(status.available, true)
  assert.equal(status.initialized, true)
  assert.ok(status.skillsCount >= 3)
  const capabilities = await evaluate("window.myplane.localAiStudio('agentCoreListCapabilities')")
  assert.ok(capabilities.some(item => item.name === 'file.read'))
  assert.ok(capabilities.some(item => item.name === 'git.status'))
  assert.ok(capabilities.some(item => item.name === 'agent.git_status'))
  const skills = await evaluate("window.myplane.localAiStudio('skillsList')")
  assert.ok(skills.some(item => item.name === 'file-operations'))
  assert.ok(skills.some(item => item.name === 'agent-tools'))
  await evaluate("document.querySelector('.settings-more-trigger').click()")
  for (const tab of ['知识库', '插件', 'MCP 服务', '发现模型', '我的模型', '模型服务', '应用设置'])
    assert.equal(await evaluate(`[...document.querySelectorAll('.settings-more-menu button')].some(button => button.textContent.trim() === ${JSON.stringify(tab)})`), true, `${tab} navigation is missing`)
  assert.equal(await evaluate('typeof window.myplane.onAgentCoreEvent'), 'function')
  await navigate('MCP 服务')
  await until(() => evaluate("document.querySelector('.mcp-empty')?.textContent.includes('尚未添加外部工具')"), 'MCP empty state')
  const nodeExecutable = process.env.npm_node_execpath
  assert.ok(nodeExecutable, 'Run this smoke test through npm so the Node executable is available')
  const fixture = { id: 'smoke-tools', name: 'Smoke tools', command: nodeExecutable, args: [path.join(app.getAppPath(), 'test-mcp-server.mjs')] }
  await evaluate(`window.myplane.localAiStudio('agentCoreMcpAdd', ${JSON.stringify(fixture)})`)
  let saved = await evaluate("window.myplane.localAiStudio('agentCoreMcpList')")
  assert.equal(saved.find(server => server.id === fixture.id)?.connected, true)
  await evaluate("document.querySelector('.mcp-section-heading button').click()")
  await until(() => evaluate("document.querySelector('.mcp-tools')?.textContent.includes('echo')"), 'MCP tools visible')
  await evaluate("window.myplane.localAiStudio('agentCoreMcpDisconnect', {id:'smoke-tools'})")
  saved = await evaluate("window.myplane.localAiStudio('agentCoreMcpList')")
  assert.equal(saved.find(server => server.id === fixture.id)?.connected, false, 'Disconnect preserves saved configuration')
  assert.equal((await evaluate("window.myplane.localAiStudio('agentCoreListCapabilities')")).some(tool => tool.name.startsWith('mcp.smoke-tools.')), false)
  await evaluate("window.myplane.localAiStudio('agentCoreMcpConnect', {id:'smoke-tools'})")
  assert.equal((await evaluate("window.myplane.localAiStudio('agentCoreMcpList')")).find(server => server.id === fixture.id)?.connected, true)
  await evaluate("window.myplane.localAiStudio('agentCoreMcpRemove', {id:'smoke-tools'})")
  assert.equal((await evaluate("window.myplane.localAiStudio('agentCoreMcpList')")).length, 0)
  await navigate('我的模型')
  await until(() => evaluate("!!document.querySelector('.model-flow-callout')"), 'model library guidance')
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"筛选模型文件类型\"]')"), true)
  await evaluate("document.querySelector('.model-flow-callout .secondary-button').click()")
  await until(() => evaluate("!!document.querySelector('.service-local-panel .developer-workspace')"), 'library leads to local service')
  assert.equal(await evaluate("document.querySelector('.service-mode-switch button.active').textContent"), '本机托管')
  assert.equal(await evaluate("document.querySelector('.dev-endpoints').open"), false)
  assert.equal(await evaluate("!!document.querySelector('.dev-inspector')"), false)
  assert.equal(await evaluate("document.querySelectorAll('.dev-main-actions button').length"), 2)
  assert.equal(await evaluate("document.querySelector('.dev-main-actions').getBoundingClientRect().bottom <= innerHeight"), true)
  await evaluate("document.querySelector('.dev-main-actions button').click()")
  await until(() => evaluate("!!document.querySelector('.dev-inspector')"), 'local parameters expand')
  await evaluate("document.querySelector('.dev-main-actions button').click()")
  await evaluate("document.querySelectorAll('.service-mode-switch button')[1].click()")
  await until(() => evaluate("!!document.querySelector('.remote-connection-card')"), 'external API settings')
  assert.equal(await evaluate("document.querySelector('.service-mode-switch button.active').textContent"), '外部 API')
  assert.equal(await evaluate("[...document.querySelectorAll('.remote-connect-actions button')].some(button=>button.getAttribute('aria-label')==='保存配置（不测试）')"), true)
  assert.equal(await evaluate("document.querySelector('.remote-advanced').open"), false)
  assert.equal(await evaluate("document.querySelectorAll('.remote-connect-actions button').length"), 2)
  assert.equal(await evaluate("document.querySelector('.remote-connect-actions').getBoundingClientRect().bottom <= innerHeight"), true)
  await evaluate("document.querySelector('.remote-form-body').scrollTop=10000")
  assert.equal(await evaluate("document.querySelector('.remote-connect-actions').getBoundingClientRect().bottom <= innerHeight"), true)
  await navigate('应用设置')
  await until(() => evaluate("!!document.querySelector('[data-settings-menu=\"appearance\"]')"), 'appearance navigation')
  await evaluate("document.querySelector('[data-settings-menu=\"appearance\"]').click()")
  await until(() => evaluate("!!document.querySelector('.background-settings')"), 'background settings')
  await evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#58aacc';ctx.fillRect(0,0,40,40);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'background.png',{type:'image/png'}));
    const input=document.querySelector('.background-settings input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await until(() => evaluate("!!document.querySelector('.local-ai-studio.has-background')"), 'background image preview')
  await evaluate("const slider=document.querySelector('.background-opacity input');slider.value='25';slider.dispatchEvent(new Event('input',{bubbles:true}))")
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.local-ai-studio'),'::before').opacity"), '0.25')
  await evaluate("document.querySelector('.settings-page .page-intro .primary-button').click()")
  await until(() => evaluate("!document.querySelector('.settings-page .page-intro .primary-button').disabled"), 'background settings saved')
  window.webContents.reload()
  await until(() => !window.webContents.isLoading() && evaluate("!!document.querySelector('.local-ai-studio.has-background')"), 'background restored after reload')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.local-ai-studio'),'::before').opacity"), '0.25')
  await navigate('应用设置')
  await until(() => evaluate("!!document.querySelector('[data-settings-menu=\"appearance\"]')"), 'appearance navigation')
  await evaluate("document.querySelector('[data-settings-menu=\"appearance\"]').click()")
  await until(() => evaluate("!!document.querySelector('.background-settings')"), 'background reset control')
  await evaluate("document.querySelectorAll('.background-actions button')[1].click()")
  assert.equal(await evaluate("!!document.querySelector('.local-ai-studio.has-background')"), false)
  await evaluate("document.querySelector('[aria-label=\"会话\"]').click()")
  await until(() => evaluate("!!document.querySelector('.chat-view .chat-workbench') && document.querySelector('[aria-label=\"会话\"]').getAttribute('aria-current') === 'page'"), 'return to chat')
  console.log('Agent Core standalone smoke passed')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  clearTimeout(watchdog)
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  fs.rmSync(root, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
}
}
void main()
