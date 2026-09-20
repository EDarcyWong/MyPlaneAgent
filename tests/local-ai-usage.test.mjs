import test from 'node:test'
import assert from 'node:assert/strict'
import {readTokenUsage,mergeTokenUsage,emptyTokenUsageTotals,updateTokenUsageTotals,sumTokenUsage} from '../dist-electron/shared/local-ai-usage.js'

test('reads OpenAI usage and llama.cpp timings without estimating missing values',()=>{
 assert.deepEqual(readTokenUsage({usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}),{inputTokens:100,outputTokens:20,totalTokens:120})
 assert.deepEqual(readTokenUsage({usage:{input_tokens:8,output_tokens:2}}),{inputTokens:8,outputTokens:2,totalTokens:10})
 assert.deepEqual(readTokenUsage({timings:{prompt_n:30,predicted_n:4}}),{inputTokens:30,outputTokens:4,totalTokens:34})
 assert.deepEqual(readTokenUsage({usage:{prompt_tokens:100,completion_tokens:20},timings:{prompt_n:1,predicted_n:2}}),{inputTokens:100,outputTokens:20,totalTokens:120})
 assert.deepEqual(readTokenUsage({usage:{completion_tokens:0}}),{outputTokens:0})
 assert.deepEqual(readTokenUsage({usage:{total_tokens:9}}),{totalTokens:9})
 for(const value of [undefined,null,{}, {usage:null},{usage:{prompt_tokens:-1,completion_tokens:NaN,total_tokens:'20'}},{usage:{prompt_tokens:Infinity,completion_tokens:1.5,total_tokens:Number.MAX_SAFE_INTEGER+1}}])assert.equal(readTokenUsage(value),undefined)
})
test('repeated usage snapshots update one request without double counting',()=>{
 const total=emptyTokenUsageTotals();total.requests=1;let previous
 for(const snapshot of [{inputTokens:100,outputTokens:0},{outputTokens:5},{outputTokens:5},{inputTokens:100,outputTokens:20,totalTokens:120}]){
  const next=mergeTokenUsage(previous,snapshot);updateTokenUsageTotals(total,previous,next);previous=next
 }
 assert.deepEqual(total,{requests:1,inputTokens:100,outputTokens:20,totalTokens:120,inputReports:1,outputReports:1,totalReports:1})
})
test('partial reports remain distinguishable from real zero usage',()=>{
 const total=sumTokenUsage([{inputTokens:20,outputTokens:5,totalTokens:25},undefined,{outputTokens:0}])
 assert.deepEqual(total,{requests:3,inputTokens:20,outputTokens:5,totalTokens:25,inputReports:1,outputReports:2,totalReports:1})
 assert.deepEqual(sumTokenUsage([]),emptyTokenUsageTotals())
})
