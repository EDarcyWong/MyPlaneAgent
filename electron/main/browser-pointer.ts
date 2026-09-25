/** Visual feedback only: the overlay never receives input or exposes a page API. */
export function browserPointerScript(point?: { x: number; y: number }): string {
 return `(() => {
  const previous = globalThis.__myplanePointer;
  ${point ? '' : 'previous?.dispose(); return;'}
  if (!document.documentElement) return;
  let pointer = previous;
  if (!pointer?.host.isConnected) {
   previous?.dispose();
   const host = document.createElement('div');
   host.setAttribute('aria-hidden', 'true');
   host.setAttribute('data-myplane-pointer', '');
   host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important;';
   const shadow = host.attachShadow({mode:'closed'});
   shadow.innerHTML = \`<style>
    :host, * { pointer-events:none !important; }
    .position { position:absolute;left:0;top:0;opacity:1;transition:opacity 220ms ease; }
    .cursor { position:absolute;left:-3px;top:-3px;width:27px;height:32px;filter:drop-shadow(0 2px 3px #0005); }
    .ring { position:absolute;left:-18px;top:-18px;width:36px;height:36px;box-sizing:border-box;border:2px solid #7660e5;border-radius:50%;background:#8068ee25; }
    .badge { position:absolute;left:21px;top:22px;padding:3px 7px;border-radius:9px;background:#6950ce;color:white;font:600 10px/14px system-ui,sans-serif;box-shadow:0 1px 5px #0002;white-space:nowrap; }
    .badge::after { content:'Agent'; }
    @media(prefers-reduced-motion:reduce) { .position { transition:none; } }
   </style><div class="position"><div class="ring"></div><svg class="cursor" viewBox="0 0 27 32" fill="none"><path d="M3 3L4 25L10 19L15 29L20 26L15 17L24 16Z" fill="#6950ce" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg><span class="badge"></span></div>\`;
   const position = shadow.querySelector('.position'), ring = shadow.querySelector('.ring');
   let fade, remove;
   const dispose = () => {
    clearTimeout(fade);clearTimeout(remove);host.remove();
    window.removeEventListener('scroll',dispose,true);window.removeEventListener('resize',dispose);
    if(globalThis.__myplanePointer===pointer)globalThis.__myplanePointer=undefined;
   };
   pointer = {host,dispose,show(x,y){
    clearTimeout(fade);clearTimeout(remove);
    position.style.transform='translate('+x+'px,'+y+'px)';position.style.opacity='1';
    ring.getAnimations().forEach(animation=>animation.cancel());
    if(!matchMedia('(prefers-reduced-motion:reduce)').matches)ring.animate([
     {transform:'scale(.35)',opacity:1},{transform:'scale(1.5)',opacity:0}
    ],{duration:550,fill:'forwards'});
    fade=setTimeout(()=>{position.style.opacity='0'},1400);
    remove=setTimeout(dispose,1650);
   }};
   globalThis.__myplanePointer=pointer;
   document.documentElement.append(host);
   window.addEventListener('scroll',dispose,true);window.addEventListener('resize',dispose);
  }
  pointer.show(${point?.x ?? 0},${point?.y ?? 0});
 })()`
}
