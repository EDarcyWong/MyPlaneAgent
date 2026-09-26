import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {ToolRegistry,builtinSpecs,boundedTool} from '../dist-electron/main/agent/registry.js'
import {LocalAgentService} from '../dist-electron/main/agent/service.js'
import {AgentWorkspace} from '../dist-electron/main/agent/workspace.js'
import {AgentMcpManager} from '../dist-electron/main/agent/mcp.js'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check){const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)throw new Error('timeout');await sleep(10)}}
const call=(name,args)=>({id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}})
const reply=calls=>({choices:[{finish_reason:calls?.length?'tool_calls':'stop',message:{role:'assistant',content:calls?.length?null:'完成',tool_calls:calls}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}})
const fixtureDisposals=new WeakMap()
function disposeFixture(t,resource){const list=fixtureDisposals.get(t)||[];list.push(()=>resource.dispose());fixtureDisposals.set(t,list)}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-reliability-'));t.after(async()=>{for(const dispose of fixtureDisposals.get(t)||[])await dispose();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})});return root}
async function harness(t,model,external){const root=fixture(t),workspace=path.join(root,'project');fs.mkdirSync(workspace);let requests=0;const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;try{res.end(JSON.stringify(await model(JSON.parse(raw),requests++)))}catch(e){res.statusCode=500;res.end(String(e))}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()});const service=new LocalAgentService(path.join(root,'tasks'),()=>({endpoint:`http://127.0.0.1:${server.address().port}`,key:'',maxTokens:1024,contextLength:32768}),external);t.after(()=>service.dispose());const start=extra=>service.start({workspace,mode:'coding',model:'test',prompt:'执行测试',maxSteps:20,...extra},1,()=>{});return {root,workspace,service,start,requests:()=>requests}}

test('registry rejects malformed JSON, extra fields, nested fields and unknown tools without coercion',()=>{
 const registry=new ToolRegistry(builtinSpecs())
 for(const [name,args] of [['read_file','{'],['read_file','{}'],['read_file','{"path":"a","extra":1}'],['read_file','{"path":42}'],['apply_patch','{"changes":[{"path":"a","after":"x","extra":1}]}'],['no_such_tool','{}']])assert.throws(()=>registry.parse(name,args),error=>['INVALID_ARGUMENTS','UNKNOWN_TOOL'].includes(error.code))
 assert.deepEqual(registry.parse('read_file','{"path":"a"}'),{path:'a'})
})
test('schema errors get one repair; a second invalid invocation stops without writes and logs redacted audit',async t=>{
 const h=await harness(t,()=>reply([call('write_file',{path:'x',content:'PRIVATE-PAYLOAD',extra:true})]))
 const task=h.start();await until(()=>!h.service.active(task.id));const result=h.service.get(task.id)
 assert.equal(result.status,'stopped');assert.equal(h.requests(),2);assert.equal(fs.existsSync(path.join(h.workspace,'x')),false)
 assert.equal(result.events.filter(event=>event.audit).length,2);assert.equal(result.events.at(-1).audit.errorCode,'INVALID_ARGUMENTS');assert.ok(result.events.at(-1).audit.durationMs>=0)
 assert.ok(!h.service.audit(task.id).includes('PRIVATE-PAYLOAD'))
})
test('a corrected call proceeds, repeated failures pause, and no-op read loops are bounded',async t=>{
 let h=await harness(t,(_body,n)=>n===0?reply([call('read_file',{})]):n===1?reply([call('read_file',{path:'ok.txt'})]):reply())
 fs.writeFileSync(path.join(h.workspace,'ok.txt'),'good');let task=h.start();await until(()=>!h.service.active(task.id));assert.equal(h.service.get(task.id).status,'completed')
 h=await harness(t,()=>reply([call('read_file',{path:'missing'})]));task=h.start();await until(()=>!h.service.active(task.id));assert.equal(h.requests(),3);assert.match(h.service.get(task.id).error,/连续失败/)
 h=await harness(t,()=>reply([call('list_files',{})]));task=h.start();await until(()=>!h.service.active(task.id));assert.equal(h.requests(),4);assert.match(h.service.get(task.id).error,/重复调用/)
})
test('distinct failures use the expanded cumulative failure limit',async t=>{
 const h=await harness(t,(_body,n)=>reply([call('read_file',{path:`missing-${n}.txt`})])),task=h.start()
 await until(()=>!h.service.active(task.id));const result=h.service.get(task.id)
 assert.equal(h.requests(),10);assert.equal(result.events.filter(event=>event.status==='failed').length,10);assert.match(result.error,/达到 10 次失败上限/)
})
test('read-only blocks writes; scoped auto mode edits ordinary files but keeps scripts and commands gated',async t=>{
 const h=await harness(t,body=>reply(body.messages.some(message=>message.role==='tool')?undefined:[call('write_file',{path:'src/a.ts',content:'new'})]));fs.mkdirSync(path.join(h.workspace,'src'));let project=h.service.createProject(h.workspace,'web')
 h.service.updateProject({id:project.id,policy:'read-only',autoWritePaths:[]});let task=h.start({projectId:project.id});await until(()=>!h.service.active(task.id));assert.equal(fs.existsSync(path.join(h.workspace,'src/a.ts')),false);assert.equal(h.service.get(task.id).events.find(event=>event.tool==='write_file').status,'rejected')
 h.service.updateProject({id:project.id,policy:'project-auto',autoWritePaths:['src']});task=h.start({projectId:project.id});await until(()=>!h.service.active(task.id));assert.equal(fs.readFileSync(path.join(h.workspace,'src/a.ts'),'utf8'),'new');assert.equal(h.service.get(task.id).events.find(event=>event.tool).audit.authorization,'automatic')
 const workspace=new AgentWorkspace(h.workspace);assert.equal(workspace.canAutoWrite('write_file',{path:'package.json'},['.']),false);assert.equal(workspace.canAutoWrite('write_file',{path:'src/test.sh'},['src']),false);assert.equal(workspace.canAutoWrite('run_command',{command:'npm test'},['.']),false)
})
test('rejecting a file write cannot be bypassed with a batch patch',async t=>{
 const h=await harness(t,(_body,n)=>reply(n===0?[call('write_file',{path:'a',content:'x'})]:[call('apply_patch',{changes:[{path:'a',after:'x'}]})]))
 const task=h.start();await until(()=>h.service.get(task.id).status==='waiting');h.service.approve(task.id,h.service.get(task.id).events.at(-1).id,false,1);await until(()=>!h.service.active(task.id));assert.equal(fs.existsSync(path.join(h.workspace,'a')),false);assert.equal(h.requests(),2)
})
test('multi-file patches validate every baseline before any write and detect user edits while awaiting approval',async t=>{
 const root=fixture(t),workspace=new AgentWorkspace(root);fs.writeFileSync(path.join(root,'a'),'old');fs.writeFileSync(path.join(root,'b'),'old')
 await assert.rejects(workspace.prepare('apply_patch',{changes:[{path:'a',before:'old',after:'new'},{path:'b',before:'wrong',after:'new'}]}));assert.equal(workspace.read('a'),'old')
 const patch=await workspace.prepare('apply_patch',{changes:[{path:'a',before:'old',after:'new'},{path:'b',before:'old',after:'new'}]});fs.writeFileSync(path.join(root,'b'),'user');await assert.rejects(patch.execute(new AbortController().signal));assert.equal(workspace.read('a'),'old');assert.equal(workspace.read('b'),'user')
 const good=await workspace.prepare('apply_patch',{changes:[{path:'a',before:'old',after:'new'},{path:'new',after:'created'}]});await good.execute(new AbortController().signal);assert.equal(workspace.read('a'),'new');assert.equal(workspace.read('new'),'created')
})
test('cooperative tool timeouts settle the operation and token budgets stop before another model call',async t=>{
 let finished=false;await assert.rejects(boundedTool(new AbortController().signal,20,signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{finished=true;reject(signal.reason)},{once:true}))),/超时/);assert.equal(finished,true)
 const h=await harness(t,()=>reply([call('list_files',{})]));const task=h.start({tokenBudget:10});await until(()=>!h.service.active(task.id));assert.equal(h.requests(),1);assert.match(h.service.get(task.id).error,/Token 预算/)
})
test('MCP stdio is discovered but never enabled implicitly; schema changes, disconnect and tool errors fail closed',async t=>{
 const root=fixture(t),log=path.join(root,'calls.jsonl'),manager=new AgentMcpManager(path.join(root,'mcp.json'),()=>({workspace:root}),text=>Buffer.from(text).toString('base64'),text=>Buffer.from(text,'base64').toString())
 disposeFixture(t,manager)
 let config=manager.save({projectId:'project',name:'fixture',transport:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/agent-mcp-server.mjs')],env:{CALL_LOG:log,SECRET_VALUE:'private-value'},enabledTools:[]})
 assert.ok(!JSON.stringify(manager.list()).includes('private-value'));assert.ok(!fs.readFileSync(path.join(root,'mcp.json'),'utf8').includes('private-value'))
 await manager.connect(config.id);assert.equal(manager.list()[0].tools.length,1);assert.equal(manager.specs('project').length,0);assert.equal(manager.specs('other').length,0)
 config=manager.save({...config,enabledTools:['echo']});let [spec]=manager.specs('project');assert.equal(spec.risk,'high');new ToolRegistry([spec]);assert.match(await spec.execute({text:'hello'},new AbortController().signal),/echo: hello/)
 const longText='中文日志'.repeat(12000)+'FINAL-ERROR';assert.equal(JSON.parse(await spec.execute({text:longText},new AbortController().signal)).content[0].text,'echo: '+longText)
 await assert.rejects(spec.execute({text:'fail'},new AbortController().signal),error=>error.code==='MCP_TOOL_ERROR')
 await spec.execute({text:'changed'},new AbortController().signal);await sleep(40);assert.equal(manager.specs('project').length,0);await assert.rejects(spec.execute({text:'hello'},new AbortController().signal),/变化/)
 await manager.disconnect(config.id);await manager.connect(config.id);[spec]=manager.specs('project');assert.ok(spec)
 await assert.rejects(spec.execute({text:'disconnect'},new AbortController().signal),error=>error.code==='RESULT_UNKNOWN');assert.notEqual(manager.list()[0].status,'connected')
 assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').filter(line=>line.includes('disconnect')).length,1)
 await manager.remove(config.id);assert.equal(manager.list().length,0)
})

test('restoration checks all current files, removes newly created files, and writes an audit event',async t=>{
 const h=await harness(t,(_body,n)=>n===0?reply([call('apply_patch',{changes:[{path:'a',before:'old',after:'new'},{path:'b',after:'created'}]})]):reply())
 fs.writeFileSync(path.join(h.workspace,'a'),'old');const project=h.service.createProject(h.workspace,'web');h.service.updateProject({id:project.id,policy:'project-auto',autoWritePaths:['.']})
 const task=h.start({projectId:project.id});await until(()=>!h.service.active(task.id));const event=h.service.get(task.id).events.find(item=>item.tool==='apply_patch');assert.equal(event.status,'completed')
 fs.writeFileSync(path.join(h.workspace,'a'),'user edit');await assert.rejects(h.service.restore(task.id,event.id),/后续修改/);assert.equal(fs.readFileSync(path.join(h.workspace,'b'),'utf8'),'created')
 fs.writeFileSync(path.join(h.workspace,'a'),'new');const restored=await h.service.restore(task.id,event.id);assert.equal(fs.readFileSync(path.join(h.workspace,'a'),'utf8'),'old');assert.equal(fs.existsSync(path.join(h.workspace,'b')),false);assert.equal(restored.events.at(-1).tool,'restore_change');assert.match(h.service.audit(task.id),/restore_change/);await assert.rejects(h.service.restore(task.id,event.id),/已恢复/)
})
test('Git tools disable executable diff/fsmonitor hooks and exclude sensitive file contents',async t=>{
 const {execFileSync}=await import('node:child_process'),root=fixture(t),marker=path.join(root,'hook-ran'),workspace=new AgentWorkspace(root)
 const git=(...args)=>execFileSync('git',args,{cwd:root,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}})
 git('init','-q');git('config','user.email','fixture@example.test');git('config','user.name','fixture');fs.writeFileSync(path.join(root,'a.txt'),'before');fs.writeFileSync(path.join(root,'.env'),'PRIVATE');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-qm','initial')
 const hook=path.join(root,'hook.sh');fs.writeFileSync(hook,'#!/bin/sh\ntouch "'+marker+'"\n',{mode:0o755});git('config','diff.external',hook);git('config','core.fsmonitor',hook)
 fs.writeFileSync(path.join(root,'a.txt'),'after');fs.writeFileSync(path.join(root,'.env'),'SECRET-NEW');const signal=new AbortController().signal
 assert.match(await workspace.query('git_status',{},signal),/a.txt/);const diff=await workspace.query('git_diff',{},signal);assert.match(diff,/after/);assert.ok(!diff.includes('SECRET-NEW'));assert.match(await workspace.query('git_log',{},signal),/initial/);assert.equal(fs.existsSync(marker),false)
})
test('test scripts require confirmation and nonzero exits are failed verification',async t=>{
 const h=await harness(t,(_body,n)=>n===0?reply([call('run_test',{script:'test',timeoutSeconds:10})]):reply());fs.writeFileSync(path.join(h.workspace,'package.json'),JSON.stringify({scripts:{test:'node -e "process.exit(7)"'}}));const project=h.service.createProject(h.workspace,'web');h.service.updateProject({id:project.id,policy:'project-auto',autoWritePaths:['.']})
 const task=h.start({projectId:project.id});await until(()=>h.service.get(task.id).status==='waiting');const event=h.service.get(task.id).events.at(-1);h.service.approve(task.id,event.id,true,1);await until(()=>!h.service.active(task.id));const result=h.service.get(task.id),record=result.events.find(item=>item.tool==='run_test');assert.equal(record.status,'failed');assert.equal(record.audit.exitCode,7);assert.equal(record.audit.authorization,'confirmed');assert.deepEqual(result.facts.verified,[])
})
test('external tools always require approval and failures are not automatically replayed',async t=>{
 let calls=0;const {ToolError}=await import('../dist-electron/main/agent/registry.js');const spec={definition:{type:'function',function:{name:'external',description:'fixture',parameters:{type:'object',properties:{},additionalProperties:false}}},source:'mcp:fixture',risk:'high',timeoutMs:1000,execute:async()=>{calls++;throw new ToolError('MCP_TOOL_ERROR','external failed')}}
 const h=await harness(t,()=>reply([call('external',{})]),()=>[spec]);const task=h.start();await until(()=>h.service.get(task.id).status==='waiting');assert.equal(calls,0);h.service.approve(task.id,h.service.get(task.id).events.at(-1).id,true,1);await until(()=>!h.service.active(task.id));assert.equal(calls,1);assert.equal(h.requests(),1);assert.equal(h.service.get(task.id).status,'stopped')
 const denied=h.start();await until(()=>h.service.get(denied.id).status==='waiting');h.service.approve(denied.id,h.service.get(denied.id).events.at(-1).id,false,1);await until(()=>!h.service.active(denied.id));assert.equal(calls,1)
})
test('model capability probe checks the actual nonce and persists reported usage',async t=>{
 const {probeModel}=await import('../dist-electron/main/agent/probe.js');const h=await harness(t,body=>reply([call('report_probe',{nonce:body.messages[0].content.match(/nonce ([\w-]+)/)[1]})]));const file=path.join(h.root,'profiles.json');const profile=await probeModel(file,h.service.connection(),'test',new AbortController().signal)
 assert.equal(profile.tools,true);assert.equal(profile.usage.totalTokens,12);assert.equal(profile.image,'not-tested');assert.equal(JSON.parse(fs.readFileSync(file,'utf8'))[0].model,'test')
})
test('generated documents are reopened and extracted sources retain paragraph and sheet references',async t=>{
 const {extractDocument}=await import('../dist-electron/main/agent/documents.js');const root=fixture(t),workspace=new AgentWorkspace(root),signal=new AbortController().signal
 for(const [name,args] of [['create_document',{path:'report.docx',title:'Report',content:'## Source\nEvidence'}],['create_spreadsheet',{path:'data.xlsx',sheets:[{name:'Data',rows:[['Title','Value'],['a',3]]}]}]]){const prepared=await workspace.prepare(name,args);const result=JSON.parse(await prepared.execute(signal));assert.equal(result.validation.readable,true);const extracted=JSON.parse(await extractDocument(path.join(root,args.path),{},signal));assert.ok(extracted.locations.length);assert.match(extracted.locations[0].label,name==='create_document'?/段落/:/工作表/)}
})

test('MCP Streamable HTTP uses explicit credentials and rejects redirects and changed schemas before execution',async t=>{
 const root=fixture(t),requests=[];let changed=false,executed=0
 const tool=()=>({name:'echo',description:changed?'changed description':'fixture',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}})
 const server=createServer(async(req,res)=>{
  requests.push({auth:req.headers.authorization,method:req.method});if(req.url==='/redirect'){res.writeHead(307,{location:'/mcp'});res.end();return}
  if(req.method==='GET'){res.writeHead(405);res.end();return}let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw)
  if(body.id===undefined){res.writeHead(202);res.end();return}
  let result=body.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'http-fixture',version:'1'}}:body.method==='tools/list'?{tools:[tool()]}:body.method==='tools/call'?(executed++,{content:[{type:'text',text:body.params.arguments.text}]}):{}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}))
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()})
 const manager=new AgentMcpManager(path.join(root,'mcp.json'),()=>({workspace:root}),value=>Buffer.from(value).toString('base64'),value=>Buffer.from(value,'base64').toString());disposeFixture(t,manager)
 let config=manager.save({projectId:'p',name:'http',transport:'http',url:`http://127.0.0.1:${server.address().port}/mcp`,token:'fixture-secret',enabledTools:[]});await manager.connect(config.id);config=manager.save({...config,enabledTools:['echo']});const [spec]=manager.specs('p');assert.match(await spec.execute({text:'ok'},new AbortController().signal),/ok/);assert.equal(executed,1);assert.ok(requests.every(request=>request.auth==='Bearer fixture-secret'));changed=true;await assert.rejects(spec.execute({text:'no'},new AbortController().signal),error=>error.code==='MCP_CHANGED');assert.equal(executed,1)
 const redirect=manager.save({projectId:'p',name:'redirect',transport:'http',url:`http://127.0.0.1:${server.address().port}/redirect`,enabledTools:[]});await assert.rejects(manager.connect(redirect.id),/连接或工具发现失败/)
})
test('MCP disconnect terminates its owned server and child process',async t=>{
 const root=fixture(t),pidFile=path.join(root,'child.pid'),fixtureFile=path.join(root,'server.mjs');fs.writeFileSync(fixtureFile,`import {spawn} from 'node:child_process';import fs from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));await import(${JSON.stringify(new URL('./fixtures/agent-mcp-server.mjs',import.meta.url).href)});`)
 const manager=new AgentMcpManager(path.join(root,'mcp.json'),()=>({workspace:root}),value=>value,value=>value);disposeFixture(t,manager);const config=manager.save({projectId:'p',name:'process',transport:'stdio',command:process.execPath,args:[fixtureFile],enabledTools:[]});await manager.connect(config.id);const pid=Number(fs.readFileSync(pidFile,'utf8'));assert.doesNotThrow(()=>process.kill(pid,0));await manager.dispose();await until(()=>{try{process.kill(pid,0);return false}catch{return true}})
})

test('malformed model call envelopes are corrected once without executing partial calls',async t=>{
 let h=await harness(t,(_body,n)=>n===0?{choices:[{message:{tool_calls:[{id:'bad',function:{name:'write_file',arguments:{path:'bad',content:'bad'}}}]}}]}:reply());let task=h.start();await until(()=>!h.service.active(task.id));assert.equal(h.requests(),2);assert.equal(h.service.get(task.id).status,'completed');assert.equal(fs.existsSync(path.join(h.workspace,'bad')),false)
 h=await harness(t,()=>({choices:[{message:{tool_calls:'bad'}}]}));task=h.start();await until(()=>!h.service.active(task.id));assert.equal(h.requests(),2);assert.equal(h.service.get(task.id).status,'failed')
})

test('pinned modern MCP protocol discovers and invokes tools without legacy initialization',async t=>{
 const root=fixture(t),manager=new AgentMcpManager(path.join(root,'mcp.json'),()=>({workspace:root}),value=>value,value=>value);disposeFixture(t,manager)
 let config=manager.save({projectId:'p',name:'modern',transport:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/agent-mcp-server.mjs')],protocol:'modern',enabledTools:[]});await manager.connect(config.id);assert.match(manager.list()[0].identity,/fixture/);config=manager.save({...config,enabledTools:['echo']});assert.match(await manager.specs('p')[0].execute({text:'modern'},new AbortController().signal),/echo: modern/)
})

test('audit excludes file contents and arbitrary external values; concurrent connects cannot spawn duplicate servers',async t=>{
 const {appendAudit}=await import('../dist-electron/main/agent/registry.js');const root=fixture(t)
 appendAudit(root,{taskId:'fixture',source:'builtin',args:{changes:[{path:'a',before:'PRIVATE-BEFORE',after:'PRIVATE-AFTER'}]}});appendAudit(root,{taskId:'fixture',source:'mcp:test',args:{arbitrary:'PRIVATE-EXTERNAL'}});const log=fs.readFileSync(path.join(root,'audit','fixture.jsonl'),'utf8');assert.ok(!log.includes('PRIVATE-'));assert.match(log,/arbitrary/)
 const manager=new AgentMcpManager(path.join(root,'mcp.json'),()=>({workspace:root}),value=>value,value=>value);disposeFixture(t,manager);const config=manager.save({projectId:'p',name:'concurrent',transport:'stdio',command:process.execPath,args:[path.resolve('tests/fixtures/agent-mcp-server.mjs')],enabledTools:[]});const results=await Promise.allSettled([manager.connect(config.id),manager.connect(config.id)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1)
})

test('MCP JSON Schema 2020-12 tuple constraints are enforced rather than silently ignored',()=>{
 const spec={definition:{type:'function',function:{name:'tuple',description:'fixture',parameters:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{pair:{type:'array',prefixItems:[{type:'string'},{type:'integer'}],items:false,minItems:2}},required:['pair'],additionalProperties:false}}},source:'mcp:fixture',risk:'high',timeoutMs:1000};const registry=new ToolRegistry([spec]);assert.deepEqual(registry.parse('tuple','{"pair":["x",2]}'),{pair:['x',2]});for(const args of ['{"pair":[2,"x"]}','{"pair":["x",2,3]}'])assert.throws(()=>registry.parse('tuple',args),error=>error.code==='INVALID_ARGUMENTS')
})
