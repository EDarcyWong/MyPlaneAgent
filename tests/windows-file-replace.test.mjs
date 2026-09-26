import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
test('both Python writers bound permission retries and preserve concurrent edits',()=>{
 const result=spawnSync(process.env.MYPLANE_PYTHON||(process.platform==='win32'?'python':'python3'),['-c',String.raw`
import importlib.util, pathlib, tempfile, os
from unittest.mock import patch
for source in ['python/agent_tools_worker.py','skills/agent-tools/engine.py']:
 spec=importlib.util.spec_from_file_location('engine_test',source); engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
 with tempfile.TemporaryDirectory() as directory:
  root=pathlib.Path(directory);file=root/'interior.js';file.write_text('old')
  plan={'kind':'write','changes':[{'path':'interior.js','expected':engine.sha(b'old'),'after':'new'}]}
  actual=os.replace
  def denied():
   error=PermissionError('access denied');error.winerror=5;return error
  count=[0]
  def transient(a,b):
   count[0]+=1
   if count[0]<3: raise denied()
   actual(a,b)
  with patch.object(engine.os,'replace',side_effect=transient),patch.object(engine.time,'sleep'):
   engine.execute_plan(root,plan)
  assert file.read_text()=='new' and count[0]==3
  file.write_text('old')
  with patch.object(engine.os,'replace',side_effect=denied()) as replace,patch.object(engine.time,'sleep'):
   try: engine.execute_plan(root,plan)
   except ValueError as error: assert '本次尚未替换任何文件' in str(error)
   else: raise AssertionError('permission error ignored')
   assert replace.call_count==3 and file.read_text()=='old'
  def edit(a,b):
   file.write_text('user edit');raise denied()
  with patch.object(engine.os,'replace',side_effect=edit) as replace,patch.object(engine.time,'sleep'):
   try: engine.execute_plan(root,plan)
   except ValueError as error: assert '文件已变化' in str(error)
   else: raise AssertionError('concurrent edit ignored')
   assert replace.call_count==1 and file.read_text()=='user edit'
`],{encoding:'utf8'})
 assert.equal(result.status,0,result.stderr||result.error?.message)
})
