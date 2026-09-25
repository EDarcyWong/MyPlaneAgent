import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCompletionReview} from '../dist-electron/main/agent/core/completion-review.js'
test('completion review rejects ambiguous, incomplete and unstructured decisions',()=>{
 for(const text of ['已完成','null','{"status":"complete","reason":""}','{"status":"continue","reason":"未完成"}','{"status":"complete","reason":"done"}{"status":"blocked","reason":"failed"}','<think>{"status":"complete","reason":"thought"}','{"status":"complete","reason":"cut'])assert.equal(parseCompletionReview(text),undefined,text)
})
test('review keeps braces in strings and validates the next step',()=>{
 assert.deepEqual(parseCompletionReview('结果：{"status":"continue","reason":"检查 {} 配置","nextStep":"读取配置"}'),{status:'continue',reason:'检查 {} 配置',nextStep:'读取配置'})
})
