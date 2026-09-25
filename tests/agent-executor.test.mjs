import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentExecutor } from '../dist-electron/main/agent/core/agent-executor.js'
const plan = steps => ({ taskId: 'test', steps, reasoning: '', createdAt: Date.now() })

test('executor reports ordered progress, optional failure and dependency failure', async () => {
  const events = []
  const calls = []
  const registry = {
    get: () => ({}),
    execute: async request => {
      calls.push(request.capability)
      return request.capability === 'bad' ? { success: false, error: 'broken' } : { success: true, output: 'ok' }
    }
  }
  const executor = new AgentExecutor(registry, undefined, event => events.push(event))
  const result = await executor.execute(plan([
    { capability: 'good', args: {} },
    { capability: 'bad', args: {}, optional: true },
    { capability: 'dependent', args: {}, dependsOn: [1] },
    { capability: 'unreached', args: {} }
  ]), '/tmp', new AbortController().signal)
  assert.equal(result.success, false)
  assert.deepEqual(calls, ['good', 'bad'])
  assert.deepEqual(events.map(event => [event.type, event.step]), [
    ['step_started', 0], ['step_completed', 0], ['step_started', 1], ['step_failed', 1], ['step_started', 2], ['step_failed', 2]
  ])
  assert.ok(events.every(event => event.taskId === 'test'))
})

for (const success of [true, false]) {
  test(`cancellation during final optional step is propagated (tool success=${success})`, async () => {
    const controller = new AbortController()
    const events = []
    const registry = { get: () => ({}), execute: async () => { controller.abort(); return { success, output: 'late', error: 'aborted' } } }
    const executor = new AgentExecutor(registry, undefined, event => events.push(event))
    await assert.rejects(executor.execute(plan([{ capability: 'tool', args: {}, optional: true }]), '/tmp', controller.signal), { name: 'AbortError' })
    assert.deepEqual(events.map(event => event.type), ['step_started'])
  })
}

test('progress observer failure does not retry an executed operation', async () => {
  let calls = 0
  const registry = { get: () => ({}), execute: async () => { calls++; return { success: true, output: 'ok' } } }
  const executor = new AgentExecutor(registry, undefined, () => { throw new Error('observer failed') })
  const result = await executor.execute(plan([{ capability: 'tool', args: {} }]), '/tmp', new AbortController().signal)
  assert.equal(result.success, true)
  assert.equal(calls, 1)
})
