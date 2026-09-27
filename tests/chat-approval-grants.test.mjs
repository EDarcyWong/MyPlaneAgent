import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatApprovalGrants} from '../dist-electron/main/agent/chat-approval-grants.js';
const operation={capability:'run_command',args:{command:'npm run check',cwd:'.'}};
test('once and rejection never grant future access',()=>{
  const grants=new ChatApprovalGrants();
  grants.approve(operation,true,'once');
  assert.equal(grants.allows(operation),false);
  for(const scope of ['similar','full']){
    grants.approve(operation,false,scope);
    assert.equal(grants.allows(operation),false);
  }
});
test('matching ignores object key order but respects arguments and tool identity',()=>{
  const grants=new ChatApprovalGrants();
  grants.approve(operation,true,'similar');
  assert.equal(grants.allows({capability:'run_command',args:{cwd:'.',command:'npm run check'}}),true);
  assert.equal(grants.allows({...operation,args:{...operation.args,command:'npm run check && other-command'}}),false);
  assert.equal(grants.allows({...operation,args:{...operation.args,cwd:'../'}}),false);
  assert.equal(grants.allows({...operation,capability:'other'}),false);
});
test('full grant applies only to its owning run',()=>{
  const grants=new ChatApprovalGrants();
  grants.approve(operation,true,'full');
  assert.equal(grants.allows({capability:'other',args:{}}),true);
  assert.equal(new ChatApprovalGrants().allows(operation),false);
});
