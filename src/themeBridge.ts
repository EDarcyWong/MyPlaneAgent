/** Extend the active surface palette to chrome and portals mounted outside it. */
export function installThemeBridge() {
 const root = document.documentElement
 const media = matchMedia('(prefers-color-scheme: dark)')
 const tokens = ['bg','panel','muted','rail','text','dim','border','accent','accent-soft','on-accent','danger','shadow']
 let frame = 0, chrome = ''
 function sync() {
  frame = 0
  const surface = document.querySelector<HTMLElement>('.local-ai-studio')
  if (!surface) return
  const css = getComputedStyle(surface)
  for (const token of tokens) root.style.setProperty(`--s-${token}`, css.getPropertyValue(`--s-${token}`).trim())
  root.style.colorScheme = css.colorScheme
  root.classList.toggle('dark', css.colorScheme === 'dark')
  root.style.fontFamily = css.fontFamily
  // Resolve CSS colors before handing them to Electron's native caption controls.
  const probe = document.createElement('span')
  probe.style.backgroundColor = 'var(--s-rail)'
  probe.style.color = 'var(--s-text)'
  root.append(probe)
  const resolved = getComputedStyle(probe)
  const color = resolved.backgroundColor, symbolColor = resolved.color
  probe.remove()
  const next = `${color}|${symbolColor}`
  if (next !== chrome) {
   chrome = next
   void window.myplane?.setTitleBarColors(color, symbolColor).catch(console.error)
  }
 }
 function schedule() { if (!frame) frame = requestAnimationFrame(sync) }
 const observer = new MutationObserver(records => {
  if (records.some(record => record.type === 'attributes'
   ? (record.target as Element).matches('.local-ai-studio')
   : [...record.addedNodes].some(node => node instanceof Element && (node.matches('.local-ai-studio') || node.querySelector('.local-ai-studio'))))) schedule()
 })
 observer.observe(document.body, { subtree:true, childList:true, attributes:true, attributeFilter:['data-theme','data-style','style'] })
 media.addEventListener('change', schedule)
 schedule()
 return () => { observer.disconnect(); media.removeEventListener('change', schedule); cancelAnimationFrame(frame) }
}
