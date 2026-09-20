import test from 'node:test'
import assert from 'node:assert/strict'
import {currentModelSelection} from '../dist-electron/shared/local-ai-model-selection.js'

const current='myplane-a4c2edf0-cabe-40',old='myplane-1537a545-d305-41'
const runtime={state:'running',modelName:current}
test('opening an old managed task selects the currently loaded model',()=>{
 assert.equal(currentModelSelection(old,'managed',runtime),current)
 assert.equal(currentModelSelection(current,'managed',runtime),current)
 assert.equal(currentModelSelection('','managed',runtime),current)
})
test('preserves external IDs, explicit model keys and selection while loading',()=>{
 assert.equal(currentModelSelection(old,'external',runtime),old)
 assert.equal(currentModelSelection('custom-model','managed',runtime),'custom-model')
 assert.equal(currentModelSelection('1537a545-d305-41a1-be48-81fab1c555f9','managed',runtime),'1537a545-d305-41a1-be48-81fab1c555f9')
 for(const state of ['starting','stopped','stopping','error'])assert.equal(currentModelSelection(old,'managed',{...runtime,state}),old)
 assert.equal(currentModelSelection(old,'managed'),old)
})
