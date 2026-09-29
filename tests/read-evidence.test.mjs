import test from 'node:test'
import assert from 'node:assert/strict'
import {readCommandPath,recoveredReadFailure} from '../dist-electron/main/agent/core/read-evidence.js'
test('read command classification is narrow and cannot hide shell mutations',()=>{
 assert.equal(readCommandPath('head -40 index.html'),'index.html')
 assert.equal(readCommandPath('Get-Content "src/my file.js"'),'src/my file.js')
 for(const command of ['head -40 index.html > out.txt','type a & del b','cat $(run)','Get-Content %TARGET%','head a | cmd','node script.js','head a\nwrite','cat --help'])assert.equal(readCommandPath(command),undefined,command)
})
test('recovery requires successful source evidence for the same file',()=>{
 const failure={status:'error',capability:'agent.run_command',args:{command:'head -40 index.html'},output:'head unavailable'}
 const success={status:'complete',capability:'agent.search_files',args:{query:'script'},output:JSON.stringify({truncated:false,matches:[{path:'index.html',text:'<script src="./main.js">'}]})}
 assert.equal(recoveredReadFailure('/work',failure,success,true),true)
 assert.equal(recoveredReadFailure('/work',failure,success),false,'source search must not replace explicit full-file reading')
 assert.equal(recoveredReadFailure('/work',failure,{...success,output:JSON.stringify({truncated:false,matches:[{path:'other.html',text:'<script>'}]})}),false)
 assert.equal(recoveredReadFailure('/work',{...failure,args:{command:'npm run build'}},success),false)
 assert.equal(recoveredReadFailure('/work',{...failure,capability:'agent.code_outline',args:{path:'index.html'},output:'请选择支持的代码文件'},success,true),true)
 assert.equal(recoveredReadFailure('/work',{...failure,capability:'agent.code_outline',args:{path:'index.html'},output:'Permission denied'},success),false)
 assert.equal(recoveredReadFailure('/work',failure,{...success,capability:'agent.read_file',args:{path:'index.html'},output:JSON.stringify({text:'1: <html>',startLine:1})}),true)
 const symbolFailure={status:'error',capability:'agent.find_symbol',args:{query:'canUndo',path:'src/composables/useGomoku.js'},output:'ValueError: 请选择目录'}
 const source={status:'complete',capability:'agent.read_file',args:{path:'src/composables/useGomoku.js'},output:JSON.stringify({text:'const canUndo = () => true',truncated:false})}
 assert.equal(recoveredReadFailure('/work',symbolFailure,source),true)
 assert.equal(recoveredReadFailure('/work',symbolFailure,{...source,output:JSON.stringify({text:'const aiMove = () => true',truncated:false})}),false)
 assert.equal(recoveredReadFailure('/work',{...symbolFailure,output:'Permission denied'},source),false)
})
