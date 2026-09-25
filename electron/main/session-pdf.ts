import {BrowserWindow} from 'electron'
import {Marked,Renderer} from 'marked'
import type {StudioSession} from '../shared/local-ai-studio.js'
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
const raster=(url:string)=>/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url)
export function sessionPdfHtml(session:StudioSession):string{
 const renderer=new Renderer()
 renderer.html=({text})=>escape(text)
 renderer.link=function({href,tokens}){const label=this.parser.parseInline(tokens);return /^https?:\/\//i.test(href)?`<a href="${escape(href)}">${label}</a>`:label}
 renderer.image=({href,text})=>raster(href)?`<img src="${escape(href)}" alt="${escape(text)}">`:`<span>[图片：${escape(text||href)}]</span>`
 const markdown=new Marked({renderer,gfm:true,breaks:true})
 const render=(text:string)=>markdown.parse(text,{async:false})
 const messages=session.messages.map(message=>`<section class="message"><h2>${message.role==='user'?'你':'AI'}${message.outcome==='blocked'||message.outcome==='needs_input'?' · 尚未完成':''}</h2>${render(message.content)}${(message.images||[]).filter(image=>raster(image.dataUrl)).map(image=>`<img src="${escape(image.dataUrl)}" alt="会话图片">`).join('')}${message.error?`<p class="error">执行提示：${escape(message.error)}</p>`:''}</section>`).join('')
 return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'"><title>${escape(session.title)}</title><style>
 @page{size:A4}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#242424;font-size:10.5pt;line-height:1.75;margin:0;overflow-wrap:anywhere}h1{font-size:22pt;line-height:1.4;margin:0 0 8pt}h2{font-size:13pt;break-after:avoid;margin:0 0 8pt}h3,h4,h5,h6{break-after:avoid}p{margin:6pt 0;orphans:3;widows:3}.meta{color:#707070;font-size:9pt;margin-bottom:22pt}.message{border-top:1px solid #ddd;padding-top:14pt;margin-top:20pt}.message h2{color:#415866}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f6;border:1px solid #e2e4e6;border-radius:5pt;padding:9pt;font-size:8.5pt;line-height:1.6}code{font-family:Menlo,Consolas,"PingFang SC",monospace}p code,li code{background:#f4f5f6;padding:1pt 3pt}blockquote{margin:8pt 0;padding-left:12pt;border-left:3pt solid #ddd;color:#666}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:9pt;margin:10pt 0}thead{display:table-header-group}th,td{border:1px solid #ddd;padding:6pt;text-align:left;overflow-wrap:anywhere}th{background:#f4f5f6}tr{break-inside:avoid}img{display:block;max-width:100%;max-height:210mm;object-fit:contain;margin:10pt 0;break-inside:avoid}a{color:#286091;text-decoration:underline}.error{color:#a33}ul,ol{padding-left:20pt}hr{border:0;border-top:1px solid #ddd}
 </style></head><body><h1>${escape(session.title)}</h1><div class="meta">模型：${escape(session.model)} · ${session.messages.length} 条消息</div>${session.systemPrompt?`<section class="message"><h2>系统提示词</h2>${render(session.systemPrompt)}</section>`:''}${messages}</body></html>`
}
export async function sessionPdf(session:StudioSession):Promise<Buffer>{
 const window=new BrowserWindow({show:false,width:900,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}})
 let timer:ReturnType<typeof setTimeout>|undefined
 try{
  return await Promise.race([
   (async()=>{await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(sessionPdfHtml(session)));return window.webContents.printToPDF({pageSize:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;text-align:center;font-size:9px;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',margins:{top:0.6,bottom:0.65,left:0.6,right:0.6},generateTaggedPDF:true})})(),
   new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('PDF 导出超时，请减少会话内容后重试')),60000)})
  ])
 }finally{clearTimeout(timer);if(!window.isDestroyed())window.destroy()}
}
