import { app, BrowserWindow, Menu } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myplane-plugin-help-'))
process.env.MYPLANE_AGENT_DATA_DIR = root
process.env.MYPLANE_AGENT_TEST_MODE = '1'
app.setAppPath(project)
const watchdog = setTimeout(() => app.exit(1), 60000)
async function until(check, label) {
  const deadline = Date.now() + 20000
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 80))
  }
}
async function main() {
  try {
    // Execute the exact documented example through its runtime protocol.
    const markdown = fs.readFileSync(path.join(project, 'src/help/plugins.md'), 'utf8')
    const manifest = JSON.parse(markdown.match(/```json\n([\s\S]*?)\n```/)[1])
    const code = markdown.match(/```python\n([\s\S]*?)\n```/)[1]
    const entry = path.join(root, 'index.py')
    fs.writeFileSync(entry, code)
    const requests = ['你好\nMyPlane', '', 123].map((text, id) => JSON.stringify({ id: String(id), tool: manifest.capabilities.tools[0].name, args: { text } }))
    const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [entry, '--runtime-mode'], { input: requests.join('\n') + '\n', encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.trim().split(/\r?\n/)
    assert.equal(lines.shift(), 'READY')
    const responses = lines.map(line => JSON.parse(line))
    assert.deepEqual(responses[0].output, { characters: 10, non_empty_lines: 2 })
    assert.deepEqual(responses[1].output, { characters: 0, non_empty_lines: 0 })
    assert.match(responses[2].error, /text 必须是字符串/)

    await import('../dist-electron/main/index.js')
    await app.whenReady()
    await until(() => BrowserWindow.getAllWindows().length, 'main window')
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const evaluate = source => mainWindow.webContents.executeJavaScript(source, true)
    await until(() => !mainWindow.webContents.isLoading(), 'renderer load')
    await until(() => evaluate("!!document.querySelector('.chat-workbench')"), 'workspace')
    const menu = Menu.getApplicationMenu().items.find(item => item.label === '帮助').submenu
    menu.items.find(item => item.label === '工作流使用指南').click()
    const help = id => BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL() || 'about:blank').searchParams.get('document') === id)
    await until(() => help('workflow') && !help('workflow').webContents.isLoading(), 'workflow help')

    await evaluate(`(() => {
      const button = [...document.querySelectorAll('.settings-rail-button')].find(item => item.getAttribute('aria-label') === '插件');
      if (button) button.click(); else document.querySelector('.settings-more-trigger').click();
    })()`)
    if (!await evaluate("!!document.querySelector('.skill-manager')")) {
      await until(() => evaluate("[...document.querySelectorAll('.settings-more-menu button')].some(item=>item.textContent.trim()==='插件')"), 'plugin menu')
      await evaluate("[...document.querySelectorAll('.settings-more-menu button')].find(item=>item.textContent.trim()==='插件').click()")
    }
    await until(() => evaluate("!!document.querySelector('.plugin-help-button')"), 'plugin help button')
    await evaluate("document.querySelector('.plugin-help-button').click()")
    await until(() => help('plugins') && !help('plugins').webContents.isLoading(), 'plugin help')
    const plugins = help('plugins')
    await until(() => plugins.webContents.executeJavaScript("!!document.querySelector('.help-section')"), 'help content')
    assert.equal(await plugins.webContents.executeJavaScript("document.querySelector('h1').textContent"), '插件编辑与使用指南')
    assert.equal(plugins.getTitle(), '插件编辑与使用指南 · MyPlaneAgent')
    assert.ok(help('workflow'), 'workflow help must remain available')
    menu.items.find(item => item.label === '插件编辑与使用指南').click()
    assert.equal(help('plugins').id, plugins.id, 'menu reuses correct document window')
    await plugins.webContents.executeJavaScript("(()=>{const input=document.querySelector('#help-search');input.value='ModuleNotFoundError';input.dispatchEvent(new Event('input',{bubbles:true}));})()")
    await until(() => plugins.webContents.executeJavaScript("document.querySelectorAll('.help-section').length===1"), 'search')
    assert.match(await plugins.webContents.executeJavaScript("document.querySelector('.help-section h2').textContent"), /常见问题/)
    await assert.rejects(evaluate("window.myplane.openHelpDocument('invalid-document')"), /帮助文档不存在/)
    console.log('Plugin help: example, menu, icon, window reuse, search and invalid document checks passed')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    // Only remove this test's verified temporary data directory.
    if (path.dirname(root) === fs.realpathSync(os.tmpdir()) && path.basename(root).startsWith('myplane-plugin-help-')) fs.rmSync(root, { recursive: true, force: true })
    app.exit(process.exitCode || 0)
  }
}
void main()
