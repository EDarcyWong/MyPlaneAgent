import { app, BrowserWindow, nativeTheme } from 'electron'
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
  await navigate('能力模块')
  await until(()=>evaluate("!!document.querySelector('[data-overview-module=completion-review]')"),'module')
  await evaluate("document.querySelector('[data-overview-module=completion-review]').click()")
  await until(()=>evaluate("!!document.querySelector('.version-list button')"),'file')
  await evaluate("document.querySelector('.version-list button').click()")
  await until(()=>evaluate("!!document.querySelector('[aria-label=放大代码编辑区]')"),'editor')
  await evaluate("document.querySelector('[aria-label=放大代码编辑区]').click()")
  await delay(100)
  assert.equal(await evaluate("document.querySelector('.fullscreen-hint').textContent.includes('Esc')"),true)
  assert.equal(await evaluate("(()=>{const b=document.querySelector('[aria-label=退出代码全屏]');const r=b.getBoundingClientRect();return r.top>=36 && b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()"),true)
  await evaluate("document.querySelector('[aria-label=退出代码全屏]').click()")
  assert.equal(await evaluate("!!document.querySelector('.code-workspace.expanded')"),false)
  await evaluate("document.querySelector('[aria-label=放大代码编辑区]').click()")
  await evaluate("document.querySelector('[aria-label=退出代码全屏]').focus()")
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
  await until(()=>evaluate("!document.querySelector('.code-workspace.expanded')"),'Escape exits')
  assert.equal(await evaluate("!!document.querySelector('.code-workspace')"),true)
  console.log('Fullscreen return button visible and clickable, Escape hint and keyboard return passed')
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

