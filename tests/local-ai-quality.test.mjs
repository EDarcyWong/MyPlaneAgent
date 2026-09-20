import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import ExcelJS from 'exceljs'
import {probeModel,modelProfile} from '../dist-electron/main/agent/probe.js'
import {extractDocument,makeDocument} from '../dist-electron/main/agent/documents.js'
import {AgentWorkspace} from '../dist-electron/main/agent/workspace.js'
import {recognizeProbe} from './fixtures/vision-probe-decoder.mjs'
const signal=()=>new AbortController().signal
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-quality-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
async function model(t,respond){const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;try{await respond(JSON.parse(raw),res)}catch(e){res.writeHead(500);res.end(String(e))}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()});return {endpoint:`http://127.0.0.1:${server.address().port}`,key:'',maxTokens:256,contextLength:8192}}
const response=(content,calls)=>({choices:[{finish_reason:calls?'tool_calls':'stop',message:{content,tool_calls:calls}}],usage:{prompt_tokens:20,completion_tokens:3,total_tokens:23}})
test('tool and random image probes persist independently, use actual image pixels, and count each request once',async t=>{
 const file=path.join(fixture(t),'profiles.json'),images=[];const connection=await model(t,(body,res)=>{if(body.tools){const nonce=body.messages[0].content.match(/nonce ([\w-]+)/)[1];res.end(JSON.stringify(response(null,[{id:'probe',type:'function',function:{name:'report_probe',arguments:JSON.stringify({nonce})}}])))}else{const content=body.messages[0].content;assert.ok(!JSON.stringify(content[0]).includes('data:image'));const image=content[1].image_url.url;images.push(image);res.end(JSON.stringify(response(recognizeProbe(image))))}})
 const tools=await probeModel(file,connection,'fixture',signal());assert.equal(tools.tools,true);assert.equal(tools.image,'not-tested')
 const image=await probeModel(file,connection,'fixture',signal(),'image');assert.equal(image.image,'passed');assert.equal(image.imagePassed,2);assert.equal(image.tools,true);assert.equal(image.toolsTestedAt,tools.toolsTestedAt);assert.equal(image.usage.totalTokens,46);assert.equal(image.lastUsage.requests,2);assert.notEqual(images[0],images[1]);assert.deepEqual(modelProfile(file,connection.endpoint,'fixture'),image);assert.equal(modelProfile(file,'http://other','fixture'),null)
 const again=await probeModel(file,connection,'fixture',signal());assert.equal(again.image,'passed');assert.equal(again.imageTestedAt,image.imageTestedAt)
})
test('cancelled probes preserve the last verified profile; wrong responses and partial usage are explicit',async t=>{
 const file=path.join(fixture(t),'profiles.json');let hold=false,started=false,count=0;const connection=await model(t,(body,res)=>{if(hold){started=true;return}const result=response('A1');if(count++%2===1)delete result.usage;res.end(JSON.stringify(result))})
 const profile=await probeModel(file,connection,'fixture',signal(),'image');assert.equal(profile.image,'failed');assert.equal(profile.usage?.totalTokens,undefined);assert.equal(profile.lastUsage.totalReports,1);assert.equal(profile.lastUsage.totalTokens,23)
 hold=true;const controller=new AbortController(),pending=probeModel(file,connection,'fixture',controller.signal,'image');const rejected=assert.rejects(pending,/cancelled/);while(!started)await new Promise(resolve=>setTimeout(resolve,10));controller.abort(new Error('cancelled'));await rejected;assert.deepEqual(modelProfile(file,connection.endpoint,'fixture'),profile)
})
test('document continuations carry file identity, preserve relative paths and reject mixed file versions',async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'nested'));fs.writeFileSync(path.join(root,'nested','notes.txt'),'a'.repeat(43000));const workspace=new AgentWorkspace(root),first=JSON.parse(await workspace.query('read_document',{path:'nested/notes.txt'},signal()));assert.equal(first.path,'nested/notes.txt');assert.equal(first.nextOffset,20000);assert.equal(first.nextReads[0].path,'nested/notes.txt');const second=JSON.parse(await workspace.query('read_document',first.nextReads[0],signal()));assert.equal(second.offset,20000);fs.appendFileSync(path.join(root,'nested','notes.txt'),'changed');await assert.rejects(workspace.query('read_document',second.nextReads[0],signal()),/已变化/)
 fs.writeFileSync(path.join(root,'control.txt'),'\u0001'.repeat(20000));const result=await extractDocument(path.join(root,'control.txt'),{},signal());assert.ok(result.length<=36000);assert.ok(JSON.parse(result).nextOffset<20000)
})
test('Excel reads rows and columns in bounded batches with precise ranges and cached-formula warnings',async t=>{
 const root=fixture(t),file=path.join(root,'book.xlsx'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Data');sheet.getCell('A1').value='first';sheet.getCell('CW1').value='column 101';sheet.getCell('A2001').value='later';sheet.getCell('B1').value={formula:'1+1'};await book.xlsx.writeFile(file)
 const first=JSON.parse(await extractDocument(file,{sheet:'Data'},signal()));assert.ok(first.locations.some(item=>item.range==='A1:CV1'));assert.deepEqual(first.metadata.uncachedFormulas,['Data!B1']);assert.equal(first.nextReads[0].startColumn,101);const second=JSON.parse(await extractDocument(file,first.nextReads[0],signal()));assert.match(second.text,/column 101/);assert.equal(second.nextReads[0].startRow,2001);const third=JSON.parse(await extractDocument(file,second.nextReads[0],signal()));assert.match(third.text,/later/);await assert.rejects(extractDocument(file,{startRow:9999},signal()),/超出范围/)
})
function pdf(pages){const font=3+pages.length*2,objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>(3+i*2)+' 0 R').join(' ')}] /Count ${pages.length} >>`];for(const [i,text] of pages.entries()){const stream=text?'BT /F1 12 Tf 30 700 Td ('+text+') Tj ET':'';objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)}objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');let body='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${object}\nendobj\n`});const xref=Buffer.byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return body}
test('PDF paging reports textless pages as unrecognized instead of interpreting headers as extracted content',async t=>{
 const root=fixture(t),file=path.join(root,'pages.pdf');fs.writeFileSync(file,pdf(Array.from({length:12},(_,i)=>i%2?'Page '+(i+1):'')));const first=JSON.parse(await extractDocument(file,{},signal()));assert.equal(first.metadata.pageCount,12);assert.equal(first.metadata.endPage,10);assert.deepEqual(first.metadata.textlessPages,[1,3,5,7,9]);assert.equal(first.metadata.mayRequireOcr,true);assert.equal(first.nextReads[0].startPage,11);const next=JSON.parse(await extractDocument(file,first.nextReads[0],signal()));assert.ok(next.locations.some(item=>item.page===12));assert.deepEqual(next.nextReads,[])
 fs.writeFileSync(file,pdf(['']));const empty=JSON.parse(await extractDocument(file,{},signal()));assert.equal(empty.extractedCharacters,0);assert.match(empty.note,/不能声称已读懂/)
})
test('Word paragraph locations and bounded metadata remain readable in long documents',async t=>{
 const root=fixture(t),file=path.join(root,'report.docx');fs.writeFileSync(file,await makeDocument(file,'Title',Array.from({length:400},(_,i)=>'Paragraph '+i).join('\n')));const result=JSON.parse(await extractDocument(file,{startParagraph:10},signal()));assert.equal(result.locations[0].paragraph,10);assert.ok(result.locations.length<=60);assert.equal(result.locationsTruncated,true);assert.equal(result.metadata.paragraphCount,401)
})

test('concurrent tool and image probes merge independent capability results',async t=>{
 const file=path.join(fixture(t),'profiles.json');const connection=await model(t,async(body,res)=>{if(body.tools){await new Promise(resolve=>setTimeout(resolve,60));const nonce=body.messages[0].content.match(/nonce ([\w-]+)/)[1];res.end(JSON.stringify(response(null,[{id:'nonce',type:'function',function:{name:'report_probe',arguments:JSON.stringify({nonce})}}])))}else res.end(JSON.stringify(response(recognizeProbe(body.messages[0].content[1].image_url.url))))})
 await Promise.all([probeModel(file,connection,'fixture',signal()),probeModel(file,connection,'fixture',signal(),'image')]);const result=modelProfile(file,connection.endpoint,'fixture');assert.equal(result.tools,true);assert.equal(result.image,'passed');assert.ok(result.toolsTestedAt);assert.ok(result.imageTestedAt)
})
