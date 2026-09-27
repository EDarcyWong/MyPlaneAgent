/** Bind only explicit, single-action requests; preserve literal paths and query terms. */
export type ExperienceRequest={kind:'file-read';values:{path:string}}|{kind:'web-research';values:{query:string}}
export function parseExperienceRequest(query:string):ExperienceRequest|undefined{
 const text=query.trim().replace(/[。！？]+$/,'')
 if(!text||text.length>400||/[\r\n，,；;]/.test(text))return
 if(/然后|并且|保存|写入|修改|删除|发送|安装|执行|对比|比较|编写|不要|不用|无需|禁止|指定|必须|只(?:用|查|搜|看)|仅(?:用|查|搜|限)|(?:并|再)(?:总结|解释|分析|读取|搜索)|\b(?:then|also|and|save|write|delete|execute|install|compare|without)\b|do\s+not|don't/i.test(text))return
 const chinese=text.replace(/^(?:请(?:你)?|麻烦(?:你)?|能否|可以)?(?:帮我)?\s*/,'')
 const file=chinese.match(/^(?:读取|读一下|读一读|查看|看一下|查阅)(?:一下)?\s*(?:文件(?=\s|["'\x60“「])\s*)?(.+?)(?:的内容)?$/)
  ??text.match(/^(?:please\s+)?(?:read|show|view)(?:\s+me)?(?:\s+the)?(?:\s+file)?\s+(.+)$/i)
 if(file){
  let target=file[1].trim()
  const pairs:Record<string,string>={'"':'"',"'":"'","\x60":"\x60",'“':'”','「':'」'}
  const closing=pairs[target[0]]
  if(closing){
   if(target.length<3||!target.endsWith(closing))return
   target=target.slice(1,-1)
   if(target.includes(closing))return
  }else if(/\s|["'\x60“”「」]/.test(target))return
  if(!closing&&/^(?:(?:这个|那个|当前|上述|该|它|本地|项目)(?:的)?(?:文件|文档|内容)?|文件|文档|内容|this|that|it)$/i.test(target))return
  if(/^[a-z][a-z\d+.-]*:\/\//i.test(target))return
  if(!closing&&!/[\\/.]|^(?:README|LICENSE|NOTICE|Makefile|Dockerfile|CHANGELOG|AGENTS)$/i.test(target))return
  if(!target||/[<>|*?\x00-\x1f]/.test(target))return
  return {kind:'file-read',values:{path:target}}
 }
 const search=chinese.match(/^(?:联网|上网)?(?:搜索|搜一下|搜一搜|搜下|搜搜|查找|找一下|找找|查询|查一下|查一查|查下)\s*(.{2,300})$/)
  ??text.match(/^(?:please\s+)?(?:search(?:\s+for)?|look\s+up|find)\s+(.{2,300})$/i)
 if(search){
  const value=search[1].trim()
  if(value.length>=2&&value.length<=300)return {kind:'web-research',values:{query:value}}
 }
}
