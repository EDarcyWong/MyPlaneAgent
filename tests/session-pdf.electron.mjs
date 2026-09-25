import {app} from 'electron'
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {sessionPdf,sessionPdfHtml} from '../dist-electron/main/session-pdf.js'
async function main(){
 await app.whenReady()
 try{
  const session={id:'pdf-test',title:'会话导出 · 中文与代码',model:'本地模型',systemPrompt:'保留用户要求。',createdAt:'',updatedAt:'',messages:[{id:'1',role:'user',content:'请展示代码、表格与分页。',createdAt:''},{id:'2',role:'assistant',createdAt:'',content:'## 验证结果\n\n```python\ndef greet(name):\n    return "你好，" + name\n```\n\n| 项目 | 结果 |\n| --- | --- |\n| 中文显示 | 正常 |\n| 代码缩进 | 保留 |\n\n'+Array.from({length:35},(_,i)=>`### 检查项目 ${i+1}\n\n这是一段用于检查中文分页的内容。每一段都应完整显示，不出现文字重叠或裁切。`).join('\n\n')}]}
  const hostile=structuredClone(session);hostile.messages[0].content='<script>alert(1)</script>\n\n[危险链接](javascript:alert)\n\n![外部图片](https://example.com/image.png)'
  const html=sessionPdfHtml(hostile)
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('src="https:'))
  const pdf=await sessionPdf(session)
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>10000)
  writeFileSync('/tmp/myplane-session-export-test.pdf',pdf)
  console.log('Session PDF export passed')
 }catch(error){console.error(error);process.exitCode=1}finally{app.exit(process.exitCode||0)}
}
void main()
