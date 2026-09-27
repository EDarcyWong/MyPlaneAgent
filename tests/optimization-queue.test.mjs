import test from 'node:test'
import assert from 'node:assert/strict'
import {optimizationQueue} from '../dist-electron/main/ability-modules/optimization-queue.js'
const problem={id:'p'},stamp=Date.parse('2026-09-27T00:00:00Z')
const job=(n,patch={})=>({id:String(n),problemIds:['p'],createdAt:new Date(stamp+n).toISOString(),updatedAt:new Date(stamp).toISOString(),phase:'complete',resolution:'retryable',...patch})
test('failed candidate retries cool down and stop after three attempts',()=>{
 assert.equal(optimizationQueue([problem],[],stamp).ready.length,1)
 assert.equal(optimizationQueue([problem],[job(1)],stamp+59999).ready.length,0)
 assert.equal(optimizationQueue([problem],[job(1)],stamp+60000).retries,1)
 assert.equal(optimizationQueue([problem],[job(1),job(2)],stamp+299999).ready.length,0)
 assert.equal(optimizationQueue([problem],[job(1),job(2)],stamp+300000).retries,1)
 const exhausted=optimizationQueue([problem],[job(1),job(2),job(3)],stamp+999999)
 assert.equal(exhausted.ready.length,0);assert.equal(exhausted.exhausted,1)
})
test('cancellation, review-ready candidates and non-module failures never auto retry',()=>{
 for(const patch of [{phase:'cancelled'},{resolution:'review'},{resolution:'improved'},{resolution:'non-module'},{phase:'analyzing'}])assert.equal(optimizationQueue([problem],[job(1,patch)],stamp+999999).ready.length,0)
 assert.equal(optimizationQueue([problem],[job(1,{phase:'failed',resolution:undefined})],stamp+60000).retries,1)
})
