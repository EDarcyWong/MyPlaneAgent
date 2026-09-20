import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {createServer} from 'node:http'
import {AgentToolStore} from '../dist-electron/main/agent/tool-store.js'
import {PythonToolRuntime} from '../dist-electron/main/agent/python.js'

const python=process.env.MYPLANE_PYTHON||(process.platform==='win32'?'python':'python3')
const worker=path.resolve('python/agent_tools_worker.py')
function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-python-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
function call(workspace,tool,args={},context={},code){const run=spawnSync(python,[worker],{input:JSON.stringify({workspace,tool,args,context,code}),encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.stdout);const envelope=JSON.parse(run.stdout);assert.equal(envelope.error,undefined);return typeof envelope.output==='string'?envelope.output:JSON.stringify(envelope.output)}
function callAsync(workspace,tool,args={}){return new Promise((resolve,reject)=>{const child=spawn(python,[worker],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,stderr||stdout);const envelope=JSON.parse(stdout);assert.equal(envelope.error,undefined);resolve(typeof envelope.output==='string'?envelope.output:JSON.stringify(envelope.output))}catch(error){reject(error)}});child.stdin.end(JSON.stringify({workspace,tool,args}))})}

test('Python runtime reuses one worker and invalidates file caches from filesystem state',async t=>{
 const root=sandbox(t),runtime=new PythonToolRuntime(worker);t.after(()=>runtime.dispose());const signal=new AbortController().signal
 const code='def execute(args, context):\n    import os\n    print("custom diagnostic")\n    return {"pid": os.getpid(), "cwd": os.getcwd()}\n'
 const first=JSON.parse((await runtime.execute({workspace:root,tool:'worker_pid',args:{},code},signal)).output),second=JSON.parse((await runtime.execute({workspace:root,tool:'worker_pid',args:{},code},signal)).output);assert.equal(first.pid,second.pid);assert.equal(first.cwd,fs.realpathSync(root))
 fs.writeFileSync(path.join(root,'a.txt'),'one');const listed=JSON.parse((await runtime.execute({workspace:root,tool:'list_files',args:{}},signal)).output);assert.ok(listed.paths.includes('a.txt'))
 const cached=JSON.parse((await runtime.execute({workspace:root,tool:'list_files',args:{}},signal)).output);assert.equal(cached.cached,true)
 fs.writeFileSync(path.join(root,'b.txt'),'two');const refreshed=JSON.parse((await runtime.execute({workspace:root,tool:'list_files',args:{}},signal)).output);assert.ok(refreshed.paths.includes('b.txt'));assert.equal(refreshed.cached,undefined)
 fs.writeFileSync(path.join(root,'a.txt'),'updated value');const read=JSON.parse((await runtime.execute({workspace:root,tool:'read_file',args:{path:'a.txt'}},signal)).output);assert.match(read.text,/updated value/)
})

test('Python worker reads, searches and atomically writes workspace files',t=>{
 const root=sandbox(t);fs.writeFileSync(path.join(root,'before.txt'),'alpha\nbeta\n')
 assert.match(JSON.parse(call(root,'list_files',{path:'.'})).paths.join(','),/before\.txt/)
 assert.match(JSON.parse(call(root,'read_file',{path:'before.txt'})).text,/1: alpha/)
 assert.equal(JSON.parse(call(root,'search_files',{query:'BETA'})).matches[0].line,2)
 const prepared=JSON.parse(call(root,'write_file',{path:'after.txt',content:'created'},{phase:'plan'}));assert.equal(prepared.preview.path,'after.txt');assert.equal(fs.existsSync(path.join(root,'after.txt')),false)
 const saved=JSON.parse(call(root,'write_file',{},{phase:'commit',plan:prepared.plan}));assert.deepEqual(saved.paths,['after.txt']);assert.equal(fs.readFileSync(path.join(root,'after.txt'),'utf8'),'created')
})

test('Python worker creates readable DOCX and XLSX artifacts',t=>{
 const root=sandbox(t)
 for(const [tool,args,file] of [['create_document',{path:'report.docx',title:'Title',content:'Body'},'report.docx'],['create_spreadsheet',{path:'report.xlsx',sheets:[{name:'Data',rows:[['Name','Count'],['A',2]]}]},'report.xlsx']]){
  const prepared=JSON.parse(call(root,tool,args,{phase:'plan'}));call(root,tool,{},{phase:'commit',plan:prepared.plan});assert.equal(fs.readFileSync(path.join(root,file)).subarray(0,2).toString(),'PK')
 }
 assert.match(JSON.parse(call(root,'read_document',{path:'report.docx'})).text,/Title/);assert.match(JSON.parse(call(root,'read_document',{path:'report.xlsx'})).text,/Name/)
 const archive=JSON.parse(call(root,'archive_inspect',{path:'report.docx'}));assert.equal(archive.kind,'zip');for(const expected of ['word/document.xml','word/styles.xml','word/settings.xml','word/_rels/document.xml.rels','docProps/core.xml','docProps/app.xml'])assert.ok(archive.entries.some(entry=>entry.path===expected),expected)
 const invalid=spawnSync(python,[worker],{input:JSON.stringify({workspace:root,tool:'create_document',args:{path:'invalid.doc',title:'Title',content:'Body'},context:{phase:'plan'}}),encoding:'utf8'});assert.notEqual(invalid.status,0);assert.match(JSON.parse(invalid.stdout).error,/\.docx/)
 for(const tool of ['write_file','replace_text']){const args=tool==='write_file'?{path:'fake.docx',content:'plain text'}:{path:'report.docx',oldText:'Title',newText:'Fake'};const attempt=spawnSync(python,[worker],{input:JSON.stringify({workspace:root,tool,args,context:{phase:'plan'}}),encoding:'utf8'});assert.notEqual(attempt.status,0);assert.match(JSON.parse(attempt.stdout).error,/create_document/)}
 const patch=spawnSync(python,[worker],{input:JSON.stringify({workspace:root,tool:'apply_patch',args:{changes:[{path:'fake.docx',after:'plain text'}]},context:{phase:'plan'}}),encoding:'utf8'});assert.notEqual(patch.status,0);assert.match(JSON.parse(patch.stdout).error,/create_document/)
})

test('generated DOCX can be opened by an installed office suite',t=>{
 if(process.env.TEST_WORD_CONVERSION!=='1')return t.skip('set TEST_WORD_CONVERSION=1 to run the LibreOffice integration')
 const probe=spawnSync(process.platform==='win32'?'where.exe':'which',['soffice'],{encoding:'utf8'});if(probe.status!==0)return t.skip('LibreOffice is not installed')
 const root=sandbox(t),output=path.join(root,'converted'),profile=path.join(root,'libreoffice-profile');fs.mkdirSync(output);fs.mkdirSync(profile)
 const prepared=JSON.parse(call(root,'create_document',{path:'兼容性报告.docx',title:'兼容性报告',content:'## 摘要\n\n- 中文内容\n\n| 项目 | 状态 |\n| --- | --- |\n| Word | 正常 |'},{phase:'plan'}));call(root,'create_document',{},{phase:'commit',plan:prepared.plan})
 const profileUrl='file:///'+profile.replaceAll('\\','/');const converted=spawnSync('soffice',[`-env:UserInstallation=${profileUrl}`,'--headless','--convert-to','pdf','--outdir',output,path.join(root,'兼容性报告.docx')],{encoding:'utf8',timeout:60000});assert.equal(converted.status,0,converted.stderr||converted.stdout);assert.ok(fs.existsSync(path.join(output,'兼容性报告.pdf')),converted.stdout)
})

test('Python worker inspects projects and performs semantic code searches',t=>{
 const root=sandbox(t);fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'fixture',scripts:{check:'tsc --noEmit'},dependencies:{vue:'latest'}}));fs.writeFileSync(path.join(root,'package-lock.json'),'{}');fs.writeFileSync(path.join(root,'src','app.ts'),'// TODO: add localization\nexport function greet(name: string) { return name }\nconsole.log(greet("Ada"))\n');fs.writeFileSync(path.join(root,'src','copy.ts'),'export function greet(name: string) { return name.toUpperCase() }\n')
 const project=JSON.parse(call(root,'inspect_project',{}));assert.equal(project.package.name,'fixture');assert.equal(project.package.frameworks[0],'vue');assert.equal(project.languages.TypeScript,2)
 const outline=JSON.parse(call(root,'code_outline',{path:'src/app.ts'}));assert.equal(outline.symbols[0].name,'greet');assert.equal(outline.symbols[0].line,2)
 const symbols=JSON.parse(call(root,'find_symbol',{query:'greet'}));assert.equal(symbols.matches[0].path,'src/app.ts');assert.equal(symbols.matches[0].line,2)
 const references=JSON.parse(call(root,'find_references',{query:'greet'}));assert.equal(references.matches.length,3)
 const todos=JSON.parse(call(root,'find_todos',{}));assert.equal(todos.matches[0].tag,'TODO')
 const dependencies=JSON.parse(call(root,'dependency_report',{}));assert.equal(dependencies.dependencies.dependencies[0].name,'vue');assert.deepEqual(dependencies.lockfiles,['package-lock.json'])
 const info=JSON.parse(call(root,'file_info',{path:'src/app.ts'}));assert.equal(info.kind,'file');assert.equal(info.lines,3);assert.match(info.sha256,/^[a-f0-9]{64}$/)
 const compared=JSON.parse(call(root,'compare_files',{left:'src/app.ts',right:'src/copy.ts'}));assert.equal(compared.identical,false);assert.match(compared.output,/toUpperCase/)
 const processes=JSON.parse(call(root,'process_status',{query:'python',limit:5}));assert.ok(Array.isArray(processes.processes))
})

test('Python worker reads bounded Git commit and blame details',t=>{
 const root=sandbox(t);fs.writeFileSync(path.join(root,'tracked.txt'),'first\nsecond\n')
 for(const args of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.test'],['add','tracked.txt'],['commit','-m','initial']]){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr)}
 const shown=JSON.parse(call(root,'git_show',{ref:'HEAD',path:'tracked.txt',patch:true}));assert.match(shown.output,/initial/);assert.match(shown.output,/\+first/)
 const blamed=JSON.parse(call(root,'git_blame',{path:'tracked.txt',startLine:2,endLine:2}));assert.equal(blamed.startLine,2);assert.match(blamed.output,/Fixture/)
})

test('Python worker returns structured diagnostics, targeted test results and localhost HTTP',async t=>{
 const root=sandbox(t);fs.writeFileSync(path.join(root,'broken.py'),'def broken(:\n');const diagnostics=JSON.parse(call(root,'get_diagnostics',{checker:'python',path:'broken.py'}));assert.notEqual(diagnostics.exitCode,0);assert.match(diagnostics.output,/SyntaxError/)
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node test-runner.cjs'}}));fs.writeFileSync(path.join(root,'test-runner.cjs'),'console.log("passed selected test", process.argv.slice(2).join(" "))');fs.writeFileSync(path.join(root,'sample.test.js'),'// fixture');const tested=JSON.parse(call(root,'run_test_case',{target:'sample.test.js',runner:'npm',name:'selected'}));assert.equal(tested.exitCode,0);assert.match(tested.output,/passed selected test/)
 const server=createServer((_request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({ok:true}))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const address=server.address();const http=JSON.parse(await callAsync(root,'http_request',{url:`http://127.0.0.1:${address.port}/health`}));assert.equal(http.status,200);assert.deepEqual(JSON.parse(http.body),{ok:true})
})

test('image OCR either runs locally or reports its optional dependency clearly',t=>{
 const root=sandbox(t),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');fs.writeFileSync(path.join(root,'pixel.png'),png)
 const run=spawnSync(python,[worker],{input:JSON.stringify({workspace:root,tool:'image_ocr',args:{path:'pixel.png'}}),encoding:'utf8'}),envelope=JSON.parse(run.stdout)
 if(run.status===0){const result=JSON.parse(envelope.output);assert.ok(['rapidocr-onnxruntime','pytesseract'].includes(result.provider))}else assert.match(envelope.error,/OCR|Tesseract|requirements/)
})

test('tool store increments immutable versions and restores by creating a new version',t=>{
 const root=sandbox(t),file=path.join(root,'tools.json'),runtime={revision:()=> 'runtime-v1',execute:async()=>({output:'ok',elapsedMs:1})},store=new AgentToolStore(file,runtime)
 assert.equal(store.list().length,33);assert.ok(store.list().every(tool=>tool.current.runtimeRevision==='runtime-v1'))
 const created=store.save({key:'hello_python',name:'问候',description:'返回问候',parameters:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false},python:'def execute(args, context):\n    return {"hello": args["name"]}\n',risk:'read',timeoutMs:5000,changeNote:'创建'})
 assert.equal(created.activeVersion,1);assert.equal(created.current.risk,'high','user Python remains high risk')
 const changed=store.save({id:created.id,key:created.key,name:'问候',description:'返回新的问候',parameters:created.current.parameters,python:created.current.python,risk:'high',timeoutMs:5000,changeNote:'修改说明'});assert.equal(changed.activeVersion,2);assert.equal(changed.versions.length,2)
 const restored=store.restore(created.id,1);assert.equal(restored.activeVersion,3);assert.equal(restored.current.description,'返回问候');assert.equal(restored.versions.length,3)
})

test('tool store routes built-in, control and custom tool versions through Python',async t=>{
 const root=sandbox(t),file=path.join(root,'tools.json')
 const runtime={revision:()=> 'runtime-v1',execute:async request=>({output:call(request.workspace,request.tool,request.args,request.context,request.code),elapsedMs:1})}
 const store=new AgentToolStore(file,runtime),signal=new AbortController().signal
 fs.writeFileSync(path.join(root,'input.txt'),'from python')
 const specs=store.specs(root),byName=name=>specs.find(spec=>spec.definition.function.name===name)
 assert.match(JSON.parse(await byName('read_file').execute({path:'input.txt'},signal)).text,/from python/)
 assert.deepEqual(JSON.parse(await byName('set_plan').execute({steps:[{text:'检查',status:'pending'}]},signal)).steps,[{text:'检查',status:'pending'}])
 assert.match(JSON.parse(await byName('read_history').execute({query:'needle'},signal,{history:[{role:'user',content:'needle'}]})).text,/needle/)
 const written=JSON.parse(await byName('write_file').execute({path:'output.txt',content:'saved'},signal));assert.deepEqual(written.paths,['output.txt']);assert.equal(written._preview.path,'output.txt');assert.equal(written._preview.after,'saved')
 assert.equal(fs.readFileSync(path.join(root,'output.txt'),'utf8'),'saved')
 const custom=store.save({key:'context_value',name:'上下文',description:'读取执行上下文',parameters:{type:'object',properties:{},additionalProperties:false},python:'def execute(args, context):\n    return context.get("marker", "missing")\n',risk:'read',timeoutMs:5000,changeNote:'创建'})
 const customSpec=store.specs(root).find(spec=>spec.definition.function.name===custom.key)
 assert.equal(await customSpec.execute({},signal,{marker:'passed'}),'passed')
})
