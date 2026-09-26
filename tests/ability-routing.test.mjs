import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AbilityModuleManager } from '../dist-electron/main/ability-modules/manager.js'
import { routerContract, routerBaseline, validateRouterOutput, validateRouterInput, taskMessages, taskProgress } from '../dist-electron/main/ability-modules/routing.js'

const input = (text, intent = 'new_task', taskStatus = 'ready', hasAttachments = false) => ({ messages: [{ id: 'current', text }], intent, taskStatus, hasAttachments })
function fixture(t, generate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myplane-routing-'))
  const manager = new AbilityModuleManager(root, generate, routerContract)
  manager.setPolicy({ ...manager.snapshot().policy, autoOptimize: false })
  t.after(() => { manager.dispose(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, manager }
}

test('router dedicated suite covers controls, corrections, attachments and missing goals', async t => {
  const { manager } = fixture(t)
  const report = await manager.test('bundled-v1')
  assert.equal(report.passed, true, JSON.stringify(report.tests))
  for (const [sample, action] of [[input('停止', 'question'), 'cancel'], [input('进度', 'new_task'), 'progress'], [input('继续修改', 'supplement', 'none'), 'clarify'], [input('暂停', 'new_task'), 'cancel'], [input('新任务：写诗', 'continue'), 'new_task']]) {
    assert.equal((await manager.execute(sample)).output.action, action)
  }
})

test('host rejects fabricated actions and bypasses of progress, cancel, task identity and references', () => {
  assert.throws(() => validateRouterInput(input('继续', 'bad')))
  assert.throws(() => validateRouterInput({ ...input('继续'), messages: [] }))
  assert.throws(() => validateRouterInput({ ...input('继续'), taskStatus: 'unknown' }))
  for (const [sample, output] of [
    [input('停止'), { action: 'continue' }], [input('查看进度'), { action: 'amend' }],
    [input('新任务：写诗'), { action: 'continue' }], [input('继续', 'continue', 'none'), { action: 'continue' }],
    [input('解释停止按钮', 'question'), { action: 'cancel' }], [input('继续'), { action: 'new_task' }],
    [input('停止', 'cancel', 'ready', true), { action: 'cancel' }], [input('你好'), { action: 'execute_tool' }],
    [input('你好'), { action: 'respond', permissions: 'full' }],
  ]) assert.throws(() => validateRouterOutput(output, sample))
})

test('runtime router regression rolls back only its own code and retains diagnostics', async t => {
  const { manager, root } = fixture(t)
  const code = routerBaseline.replace('function process(input)', 'function original(input)') + '\nfunction process(input){if(input.messages[0].text.includes("runtime-trigger"))return {action:"cancel"};return original(input)}'
  const version = manager.saveVersion('bundled-v1', code, '路由回退检查')
  await manager.activate(version.id)
  const result = await manager.execute(input('解释 runtime-trigger', 'question'))
  assert.equal(result.output.action, 'respond')
  assert.equal(result.versionId, 'bundled-v1')
  assert.equal(manager.snapshot().versions.length, 2)
  assert.equal(manager.snapshot().problems.length, 1)
  assert.ok(manager.snapshot().versions.find(item => item.id === version.id).quarantined)
  manager.dispose()
  const restored = new AbilityModuleManager(root, undefined, routerContract)
  t.after(() => restored.dispose())
  assert.equal(restored.snapshot().activeId, 'bundled-v1')
  assert.equal(restored.snapshot().switches.length, 2)
})

test('router feedback optimizes with its own interface and replays, preserving earlier versions', async t => {
  const code = routerBaseline.replace("if (input.intent==='question')", "if (input.taskStatus!=='none' && /改成|调整/.test(text)) return {action:'amend'};\n  if (input.intent==='question')")
  const { manager } = fixture(t, async prompt => {
    assert.match(prompt, /taskStatus/)
    assert.ok(!prompt.includes('intent 必须'))
    return JSON.stringify({ cause: 'module', diagnosis: '识别明确的修改表达', code })
  })
  const sample = input('把格式改成表格')
  manager.reportRouterProblem('修改表达被当成普通回答', sample, { action: 'amend' })
  assert.throws(() => manager.reportProblem('错误接口', ['继续'], 'continue'), /专属/)
  assert.throws(() => manager.reportRouterProblem('不能取消解释请求', input('解释停止按钮', 'question'), { action: 'cancel' }))
  manager.recordSample(sample, 'bundled-v1')
  manager.optimize()
  const deadline = Date.now() + 20000
  let job
  do { await new Promise(resolve => setTimeout(resolve, 30)); job = manager.snapshot().jobs[0] }
  while (['queued', 'analyzing', 'testing'].includes(job.phase) && Date.now() < deadline)
  assert.equal(job.phase, 'complete', job.message)
  assert.equal(manager.snapshot().activeId, job.candidateId, job.message)
  assert.equal(job.shadow.samples, 1)
  assert.equal(manager.snapshot().versions.length, 2)
})

test('task boundary isolates model context without erasing history; progress uses work records', () => {
  const session = {
    messages: [
      { id: 'old', role: 'user', content: '旧任务与约束' },
      { id: 'new', role: 'user', content: '新任务：写诗' },
      { id: 'work', role: 'assistant', content: '已生成草稿', toolActivity: [{ status: 'error' }] },
      { id: 'query', role: 'user', content: '进度' },
      { id: 'report', role: 'assistant', content: '只读查询不是新的执行证据' },
    ],
    abilityTask: { id: 'task', startMessageId: 'new', goalMessageId: 'new', status: 'complete', lastExecutionMessageId: 'work' },
  }
  assert.deepEqual(taskMessages(session).map(message => message.id), ['new', 'work', 'query', 'report'])
  assert.equal(session.messages.length, 5)
  const progress = taskProgress(session)
  assert.match(progress, /上轮报告已完成/)
  assert.match(progress, /已生成草稿/)
  assert.match(progress, /1 项失败/)
  assert.ok(!progress.includes('只读查询不是新的执行证据'))
  assert.match(taskProgress({ messages: [] }), /没有可查询/)
})
