export type BrowserAction='open'|'navigate'|'back'|'forward'|'reload'|'stop'|'external'|'state'|'plugin-state'|'enable-automation'
export type BrowserState={automationEnabled:boolean;url:string;title:string;loading:boolean;canGoBack:boolean;canGoForward:boolean;error:string}
export function browserUrl(input:unknown):string{
 if(typeof input!=='string'||!input.trim()||input.length>8000)throw new Error('请输入有效的网址')
 let value=input.trim()
 if(!/^https?:\/\//i.test(value)){
  if(/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value))value='http://'+value
  else if(/^[a-z][a-z\d+.-]*:/i.test(value))throw new Error('仅支持 HTTP 和 HTTPS 网页')
  else value='https://'+value
 }
 const url=new URL(value)
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持不含账号密码的 HTTP 和 HTTPS 网页')
 return url.href
}
