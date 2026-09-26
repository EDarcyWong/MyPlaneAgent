import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentMemory } from '../dist-electron/main/agent/core/agent-memory.js'

const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
const entry = i => ({ taskId: `task-${i}`, timestamp: i, plan: { reasoning: `task ${i}`, steps: [] }, result: { success: true, elapsedMs: 1, results: [] } })

test('history outlives the recent cache and restart without deleting old tasks', async t => {
  const root = fixture(t), memory = new AgentMemory(root)
  for (let i = 0; i < 105; i++) await memory.store(entry(i))
  assert.equal(memory.getRecent(200).length, 100)
  assert.equal(memory.query().length, 105)
  assert.equal(memory.getByTask('task-0').length, 1)
  const restored = new AgentMemory(root)
  assert.equal(restored.query().length, 105)
  assert.equal(restored.getRecent(200).length, 100)
  restored.clearShortTerm()
  assert.equal(restored.query().length, 105)
})

test('legacy cache is archived and corrupt cache is never silently overwritten', t => {
  const root = fixture(t), file = path.join(root, 'agent-memory.json')
  fs.writeFileSync(file, JSON.stringify([{ id: 'legacy', ...entry(1) }]))
  assert.equal(new AgentMemory(root).query().length, 1)
  assert.equal(fs.readdirSync(path.join(root, 'memory-history')).length, 1)
  fs.writeFileSync(file, '{broken')
  assert.throws(() => new AgentMemory(root))
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  assert.equal(fs.readdirSync(path.join(root, 'memory-history')).length, 1)
})
