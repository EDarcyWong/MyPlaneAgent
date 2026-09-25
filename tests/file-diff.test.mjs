import test from 'node:test'
import assert from 'node:assert/strict'
import {fileDiff,collapseDiff} from '../dist-electron/shared/file-diff.js'
test('line diffs preserve both versions and their line numbers',()=>{
 const diff=fileDiff('first\nold\nlast\n','first\nnew\nextra\nlast\n')
 assert.equal(diff.added,2);assert.equal(diff.removed,1)
 assert.deepEqual(diff.lines.filter(row=>row.kind!=='added').map(row=>row.text),['first','old','last'])
 assert.deepEqual(diff.lines.filter(row=>row.kind!=='removed').map(row=>row.text),['first','new','extra','last'])
 assert.deepEqual(diff.lines.at(-1),{kind:'same',text:'last',before:3,after:4})
})
test('new files, empty files, final newlines and limited previews are explicit',()=>{
 assert.equal(fileDiff('','a\nb\n').added,2)
 assert.equal(fileDiff('','').lines.length,0)
 assert.equal(fileDiff('a\n','a').newlineChanged,true)
 assert.equal(fileDiff('abcdef','abcdef',3).truncated,true)
})
test('collapsed context exposes changes and retains accurate skipped line counts',()=>{
 const before=Array.from({length:30},(_,i)=>String(i)).join('\n')
 const diff=fileDiff(before,before.replace('\n15\n','\nchanged\n'))
 const rows=collapseDiff(diff.lines)
 assert.equal(rows.filter(row=>row.kind==='gap').length,2)
 assert.equal(rows.reduce((sum,row)=>sum+(row.kind==='gap'?row.count:1),0),diff.lines.length)
 assert.deepEqual(rows.filter(row=>row.kind==='added').map(row=>row.text),['changed'])
})
