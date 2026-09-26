import test from 'node:test'
import assert from 'node:assert/strict'
import {currentModelSelection,chatModelOptions,prepareLocalChatModel} from '../dist-electron/shared/local-ai-model-selection.js'

const current='myplane-a4c2edf0-cabe-40',old='myplane-1537a545-d305-41'
const runtime={state:'running',modelName:current}
test('opening an old managed task selects the currently loaded model',()=>{
 assert.equal(currentModelSelection(old,'managed',runtime),current)
 assert.equal(currentModelSelection(current,'managed',runtime),current)
 assert.equal(currentModelSelection('','managed',runtime),current)
})

test('chat lists stopped local models and all remote services with stable distinct values',()=>{
 const local=(id,file,extra={})=>({id,file,format:'GGUF',exists:true,...extra})
 const models=[local('one','Qwen.gguf'),local('two','Llama.gguf'),local('missing','Missing.gguf',{exists:false}),local('projector','mmproj-Qwen.gguf'),local('shard','Qwen-00002-of-00003.gguf')]
 const caches=['https://one/v1','https://two/v1'].map(endpoint=>({apiFormat:'openai',endpoint,models:[{id:'shared',name:'Friendly name'}]}))
 const profiles=[{id:'profile',apiFormat:'openai',endpoint:'https://three/v1',model:'uncached'}]
 const settings={source:'managed',apiFormat:'openai',endpoint:'https://one/v1',model:'shared'}
 const rows=chatModelOptions(models,caches,profiles,settings,[{id:current,name:current}])
 assert.equal(rows.length,5)
 assert.equal(new Set(rows.map(row=>row.id)).size,5)
 assert.deepEqual(rows.slice(0,2).map(row=>row.name),['本地 · Qwen.gguf','本地 · Llama.gguf'])
 assert.equal(rows.filter(row=>row.name==='远程 · Friendly name').length,2)
 assert.equal(rows.find(row=>row.modelId==='uncached').profileId,'profile')
 assert.ok(!rows.some(row=>row.name.includes(current)))
})

function localActions(initial,states=[]){
 const calls=[]
 let state=initial
 const actions={snapshot:async()=>state,confirm:async()=>{calls.push('confirm')},stop:async()=>{calls.push('stop')},start:async()=>{calls.push('start');state={state:'starting',modelId:'new'};return state},wait:async()=>{calls.push('wait');state=states.shift()||{state:'running',modelId:'new',modelName:current}}}
 return {calls,actions}
}
test('local selection confirms, unloads other model, and waits until the chosen model is ready',async()=>{
 const {calls,actions}=localActions({state:'running',modelId:'old'})
 const ready=await prepareLocalChatModel('new',actions)
 assert.equal(ready.modelName,current)
 assert.deepEqual(calls,['confirm','stop','start','wait'])
})
test('cancel leaves the runtime untouched; an already running selection needs no confirmation',async()=>{
 const cancelled=localActions({state:'stopped'})
 cancelled.actions.confirm=async()=>{throw 'cancel'}
 await assert.rejects(prepareLocalChatModel('new',cancelled.actions),cause=>cause==='cancel')
 assert.deepEqual(cancelled.calls,[])
 const active=localActions({state:'running',modelId:'new',modelName:current})
 assert.equal((await prepareLocalChatModel('new',active.actions)).modelName,current)
 assert.deepEqual(active.calls,[])
})
test('loading model is awaited without starting twice, and startup errors are surfaced',async()=>{
 const loading=localActions({state:'starting',modelId:'new'})
 await prepareLocalChatModel('new',loading.actions)
 assert.deepEqual(loading.calls,['confirm','wait'])
 const failed=localActions({state:'stopped'},[{state:'error',modelId:'new',error:'内存不足'}])
 await assert.rejects(prepareLocalChatModel('new',failed.actions),/内存不足/)
})
test('model becoming ready while confirmation is open is reused',async()=>{
 const loading=localActions({state:'starting',modelId:'new'})
 loading.actions.confirm=async()=>{await loading.actions.wait()}
 assert.equal((await prepareLocalChatModel('new',loading.actions)).modelName,current)
 assert.deepEqual(loading.calls,['wait'])
})
test('preserves external IDs, explicit model keys and selection while loading',()=>{
 assert.equal(currentModelSelection(old,'external',runtime),old)
 assert.equal(currentModelSelection('custom-model','managed',runtime),'custom-model')
 assert.equal(currentModelSelection('1537a545-d305-41a1-be48-81fab1c555f9','managed',runtime),'1537a545-d305-41a1-be48-81fab1c555f9')
 for(const state of ['starting','stopped','stopping','error'])assert.equal(currentModelSelection(old,'managed',{...runtime,state}),old)
 assert.equal(currentModelSelection(old,'managed'),old)
})
