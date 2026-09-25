/** Dismiss only floating disclosures; inline details keep their expanded state. */
export function installFloatingMenus() {
 const openMenus=()=>document.querySelectorAll<HTMLDetailsElement>('details[data-floating-menu][open]')
 const dismissOutside=(event:Event)=>{
  const path=event.composedPath()
  for(const menu of openMenus())if(!path.includes(menu))menu.open=false
 }
 const dismissOnEscape=(event:KeyboardEvent)=>{
  if(event.key!=='Escape')return
  for(const menu of openMenus()){
   const restoreFocus=menu.contains(document.activeElement)
   menu.open=false
   if(restoreFocus)menu.querySelector<HTMLElement>('summary')?.focus()
  }
 }
 document.addEventListener('pointerdown',dismissOutside,true)
 document.addEventListener('click',dismissOutside,true)
 document.addEventListener('focusin',dismissOutside,true)
 document.addEventListener('keydown',dismissOnEscape,true)
 return ()=>{
  document.removeEventListener('pointerdown',dismissOutside,true)
  document.removeEventListener('click',dismissOutside,true)
  document.removeEventListener('focusin',dismissOutside,true)
  document.removeEventListener('keydown',dismissOnEscape,true)
 }
}
