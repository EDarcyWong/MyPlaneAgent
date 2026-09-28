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
  await navigate('应用设置')
  await until(()=>evaluate("!!document.querySelector('[data-settings-menu=general]')"),'settings')
  assert.equal(await evaluate("document.querySelector('.preferences-content h1').textContent"),'常规')
  await evaluate("document.querySelector('[data-settings-menu=storage]').click()")
  await until(()=>evaluate("document.querySelector('.preferences-content').textContent.includes('Hugging Face')"),'storage')
  await evaluate("document.querySelector('[data-settings-menu=appearance]').click()")
  await until(()=>evaluate("!!document.querySelector('[aria-label=外观模式]')"),'appearance')
  const change = async (label,value,event='change')=>evaluate(`(()=>{const el=document.querySelector('[aria-label="${label}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('${event}',{bubbles:true}));})()`)
  await change('外观模式','dark')
  assert.equal(await evaluate("document.querySelector('.local-ai-studio').dataset.theme"),'dark')
  for (const theme of ['minimal','ocean','paper','terminal']) {
    await evaluate(`document.querySelectorAll('.theme-options button')[${['minimal','ocean','paper','terminal'].indexOf(theme)}].click()`)
    for (const mode of ['light','dark','system']) {
      if(mode==='system')nativeTheme.themeSource='dark'
      await change('外观模式',mode)
      await delay(80)
      const palette=await evaluate(`(()=>{
        const surface=getComputedStyle(document.querySelector('.local-ai-studio'));
        const title=getComputedStyle(document.querySelector('.desktop-titlebar'));
        const popup=document.createElement('div');popup.className='el-dialog';document.body.append(popup);
        const colors=getComputedStyle(popup);const result={scheme:surface.colorScheme,title:title.backgroundColor,panel:colors.backgroundColor,popupText:colors.color,text:surface.color,rootScheme:getComputedStyle(document.documentElement).colorScheme};
        const probe=document.createElement('span');probe.style.background='var(--s-rail)';document.body.append(probe);result.rail=getComputedStyle(probe).backgroundColor;probe.style.background='var(--s-panel)';result.expectedPanel=getComputedStyle(probe).backgroundColor;
        popup.remove();probe.remove();return result;
      })()`)
      assert.equal(palette.scheme,mode==='light'?'light':'dark',theme+' '+mode)
      assert.equal(palette.rootScheme,palette.scheme)
      assert.equal(palette.title,palette.rail)
      assert.equal(palette.panel,palette.expectedPanel)
      assert.equal(palette.popupText,palette.text)
    }
  }
  nativeTheme.themeSource='light'
  await delay(80)
  assert.equal(await evaluate("getComputedStyle(document.documentElement).colorScheme"),'light')
  await change('外观模式','dark')
  await change('强调色','#4080c0','input')
  await change('界面字号','16')
  await change('代码字号','15')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.local-ai-studio')).getPropertyValue('--s-accent').trim()"),'#4080c0')
  await evaluate("document.querySelector('[aria-label=减少动态效果]').click()")
  assert.equal(await evaluate("document.querySelector('.local-ai-studio').classList.contains('reduce-motion')"),true)
  assert.equal(await evaluate("document.querySelectorAll('.background-presets button').length"),8)
  await until(()=>evaluate("[...document.querySelectorAll('.background-presets img')].every(img=>(img.scrollIntoView(), img.complete && img.naturalWidth>0))"),'bundled background images loaded')
  for(let index=0;index<8;index++){
    await evaluate(`document.querySelectorAll('.background-presets button')[${index}].click()`)
    assert.equal(await evaluate(`document.querySelectorAll('.background-presets button')[${index}].getAttribute('aria-pressed')`),'true')
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.local-ai-studio'),'::before').backgroundImage.includes('/backgrounds/')"),true)
  }
  await evaluate("document.querySelector('.background-settings').scrollIntoView({block:'start'})")
  await delay(200)
  fs.mkdirSync('tests/artifacts',{recursive:true})
  fs.writeFileSync('tests/artifacts/background-picker.png',(await window.webContents.capturePage()).toPNG())
  await evaluate("document.querySelectorAll('.background-presets button')[1].click()")
  assert.equal(await evaluate("document.querySelector('.local-ai-studio').style.getPropertyValue('--app-background').includes('ocean-signal.png')"),true)
  await evaluate("document.querySelector('.settings-page .primary-button').click()")
  await until(()=>evaluate("!document.querySelector('.settings-page .primary-button').disabled"),'saved')
  window.webContents.reload()
  await until(()=>evaluate("!!document.querySelector('.chat-workbench')").catch(()=>false),'reload')
  await navigate('应用设置')
  await until(()=>evaluate("!!document.querySelector('[data-settings-menu=appearance]')"),'settings reloaded')
  await evaluate("document.querySelector('[data-settings-menu=appearance]').click()")
  await until(()=>evaluate("!!document.querySelector('[aria-label=强调色]')"),'appearance reloaded')
  assert.equal(await evaluate("document.querySelector('[aria-label=强调色]').value"),'#4080c0')
  assert.equal(await evaluate("document.querySelector('[aria-label=界面字号]').value"),'16')
  assert.equal(await evaluate("document.querySelector('[aria-label=代码字号]').value"),'15')
  assert.equal(await evaluate("document.querySelector('[aria-label=减少动态效果]').checked"),true)
  assert.equal(await evaluate("document.querySelectorAll('.background-presets button')[1].getAttribute('aria-pressed')"),'true')
  await change('外观模式','light')
  window.setSize(1280,960)
  await delay(300)
  fs.mkdirSync('tests/artifacts',{recursive:true})
  fs.writeFileSync('tests/artifacts/settings-appearance.png',(await window.webContents.capturePage()).toPNG())
  assert.equal(await evaluate("document.querySelector('.preferences-content').getBoundingClientRect().left>=document.querySelector('.preferences-nav').getBoundingClientRect().right"),true)
  window.setSize(760,860)
  await delay(200)
  assert.equal(await evaluate("document.querySelector('.preferences-content').scrollWidth<=document.querySelector('.preferences-content').clientWidth"),true)
  await evaluate("document.querySelector('.reset-appearance').click()")
  assert.equal(await evaluate("document.querySelector('[aria-label=外观模式]').value"),'system')
  assert.equal(await evaluate("document.querySelector('[aria-label=界面字号]').value"),'14')
  window.setSize(1380,900)
  await evaluate("document.querySelectorAll('.theme-options button')[1].click()")
  await change('外观模式','dark')
  await navigate('能力模块')
  await delay(300)
  fs.writeFileSync('tests/artifacts/theme-ocean-dark.png',(await window.webContents.capturePage()).toPNG())
  console.log('Settings layout, all theme/mode combinations, chrome, portals, system changes, persistence, reset and narrow layout passed')
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

