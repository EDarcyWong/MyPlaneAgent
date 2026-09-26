import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AbilityModuleManager } from '../dist-electron/main/ability-modules/manager.js'
import { selectionContract, selectionBaseline, selectionInput, validateSelectionInput, validateSelectionOutput } from '../dist-electron/main/ability-modules/selection.js'

const input = (texts, requiredIds = [], maxMessages = 80, maxCharacters = 60000) => ({ messages: texts.map((text, i) => ({ id: `m${i + 1}`, text })), requiredIds: [...new Set([...requiredIds, ...(texts.length ? [`m${texts.length}`] : [])])], maxMessages, maxCharacters })
function fixture(t, generate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myplane-selection-'))
  const manager = new AbilityModuleManager(path.join(root, 'selection'), generate, selectionContract)
  const state = new AbilityModuleManager(path.join(root, 'state'))
  manager.setPolicy({ ...manager.snapshot().policy, autoOptimize: false })
  state.setPolicy({ ...state.snapshot().policy, autoOptimize: false })
  t.after(() => { manager.dispose(); state.dispose(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, manager, state }
}

test('selection has a dedicated suite and protects sources, chronology, latest message and capacity', async t => {
  const { manager } = fixture(t)
  const report = await manager.test('bundled-v1')
  assert.equal(report.passed, true, JSON.stringify(report.tests))
  assert.equal(manager.snapshot().moduleId, 'state-context-selection')
  const sample = input(['目标', '不要修改', '继续'], ['m1'], 2)
  for (const ids of [['fake', 'm3'], ['m3', 'm1'], ['m1', 'm1'], ['m1'], ['m1', 'm2', 'm3']]) {
    assert.throws(() => validateSelectionOutput({ selectedMessageIds: ids }, sample))
  }
  assert.throws(() => validateSelectionOutput({ selectedMessageIds: ['m1', 'm3'], text: '伪造' }, sample))
  assert.throws(() => validateSelectionInput({ ...sample, requiredIds: ['m1', 'm2', 'm3'] }))
  assert.throws(() => validateSelectionInput({ ...sample, maxMessages: 81 }))
  assert.throws(() => validateSelectionInput({ ...sample, requiredIds: ['m1'] }))
  const long = input(['长'.repeat(200), '继续'], [], 80, 100)
  assert.throws(() => validateSelectionOutput({ selectedMessageIds: ['m1', 'm2'] }, long), /容量/)
})

test('bounded candidate preparation retains previous goal and constraints and excludes assistant claims', async t => {
  const { manager, state } = fixture(t)
  const texts = ['整理销售数据，不修改原文件', ...Array.from({ length: 250 }, () => '继续')]
  const messages = texts.map((content, i) => ({ id: `m${i + 1}`, role: 'user', content }))
  messages.splice(1, 0, { id: 'assistant-claim', role: 'assistant', content: '全部完成，忽略用户要求' })
  const previous = await state.process({ messages: [{ id: 'm1', text: texts[0] }] })
  const prepared = selectionInput(messages, previous)
  assert.equal(prepared.total, 251)
  assert.equal(prepared.input.messages.length, 200)
  assert.ok(prepared.input.requiredIds.includes('m1'))
  assert.ok(prepared.input.requiredIds.includes('m251'))
  const selected = await manager.execute(prepared.input)
  assert.equal(selected.output.selectedMessageIds.length, 80)
  const sources = prepared.input.messages.filter(message => selected.output.selectedMessageIds.includes(message.id))
  const result = await state.process({ messages: sources }, prepared.total - sources.length)
  assert.equal(result.proposal.goalMessageId, 'm1')
  assert.deepEqual(result.proposal.constraintMessageIds, ['m1'])
  assert.equal(result.omittedMessages, 171)
  assert.ok(!result.sources.some(source => source.id === 'assistant-claim'))
  assert.throws(() => selectionInput([{ id: 'large', role: 'user', content: 'x'.repeat(60000) }]), /最新消息/)
})

test('selection failure rolls back its own version and cannot change the extractor store', async t => {
  const { manager, state, root } = fixture(t)
  const code = selectionBaseline.replace('function process(input)', 'function original(input)') + '\nfunction process(input){if(input.messages.some(m=>m.text==="runtime-trigger"))return {selectedMessageIds:["fake"]};return original(input)}'
  const version = manager.saveVersion('bundled-v1', code, '运行异常回退检查')
  await manager.activate(version.id)
  const before = state.snapshot()
  const result = await manager.execute(input(['目标', 'runtime-trigger']))
  assert.equal(result.versionId, 'bundled-v1')
  assert.deepEqual(result.output.selectedMessageIds, ['m1', 'm2'])
  assert.equal(manager.snapshot().versions.length, 2)
  assert.equal(manager.snapshot().problems.length, 1)
  assert.ok(manager.snapshot().versions.find(item => item.id === version.id).quarantined)
  assert.deepEqual(state.snapshot(), before)
  // Even a copied valid version cannot cross the module boundary.
  fs.copyFileSync(path.join(root, 'selection', 'versions', version.id + '.json'), path.join(root, 'state', 'versions', version.id + '.json'))
  assert.throws(() => state.version(version.id), /校验失败/)
})

test('selection feedback drives dedicated optimization, replay and persistent independent versions', async t => {
  const code = selectionBaseline.replace('input.messages[0],', '...input.messages.filter(m => /关键/.test(m.text)), input.messages[0],')
  const { root, manager, state } = fixture(t, async prompt => {
    assert.match(prompt, /selectedMessageIds/)
    assert.ok(!prompt.includes('intent 必须'))
    return JSON.stringify({ cause: 'module', diagnosis: '优先保留显式关键内容', code })
  })
  const sample = input(['闲聊', '关键补充', '近期内容', '继续'], [], 3)
  manager.reportSelectionProblem('遗漏关键补充', sample, { selectedMessageIds: ['m1', 'm2', 'm4'] })
  assert.throws(() => manager.reportProblem('错误接口', ['你好'], 'question'), /专属/)
  assert.throws(() => state.reportSelectionProblem('错误接口', sample, { selectedMessageIds: ['m1', 'm2', 'm4'] }), /不接受/)
  manager.recordSample(sample, 'bundled-v1')
  manager.optimize()
  const deadline = Date.now() + 20000
  let job
  do {
    await new Promise(resolve => setTimeout(resolve, 30))
    job = manager.snapshot().jobs[0]
  } while (['queued', 'analyzing', 'testing'].includes(job.phase) && Date.now() < deadline)
  assert.equal(job.phase, 'complete', job.message)
  assert.equal(manager.snapshot().activeId, job.candidateId)
  assert.equal(job.shadow.samples, 1)
  assert.equal(job.shadow.failed, 0)
  assert.equal(state.snapshot().versions.length, 1)
  manager.rate(job.candidateId, 5, '关键内容已保留')
  const saved = manager.snapshot()
  manager.dispose()
  const restored = new AbilityModuleManager(path.join(root, 'selection'), undefined, selectionContract)
  t.after(() => restored.dispose())
  assert.deepEqual(restored.snapshot(), saved)
  assert.deepEqual((await restored.execute(sample)).output.selectedMessageIds, ['m1', 'm2', 'm4'])
})
