import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentCoreService } from '../dist-electron/main/agent/agent-core-service.js'
import { CoreWorkflowAdapter } from '../dist-electron/main/agent/core-workflow-adapter.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('Agent Core plans with the selected model and executes a bundled Skill', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'myplane-core-'))
  const skillsDir = path.join(root, 'skills')
  const workspace = path.join(root, 'workspace')
  mkdirSync(skillsDir)
  mkdirSync(workspace)
  writeFileSync(path.join(workspace, 'example.txt'), 'hello')
  cpSync(path.join(projectRoot, 'skills', 'file-operations'), path.join(skillsDir, 'file-operations'), { recursive: true })
  const requestedModels = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    requestedModels.push(input.model)
    const plan = { reasoning: 'List the workspace files', steps: [{ capability: 'file.list', args: { path: '.' } }] }
    const content = String(input.messages.at(-1)?.content).includes('工具结果') ? '工作区包含 example.txt。' : JSON.stringify(plan)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const core = new AgentCoreService({
    dataDir: path.join(root, 'data'),
    skillsDir,
    getConnection: () => ({ endpoint: `http://127.0.0.1:${address.port}/v1`, key: '', maxTokens: 1024, contextLength: 8192 })
  })
  core.on('error', () => {})
  try {
    await core.initialize()
    assert.ok(core.listCapabilities().some(item => item.name === 'file.list'))
    const progress = []
    core.on('agent-event', ({ event }) => { if (event.type.startsWith('step_')) progress.push(event.type) })
    const result = await core.runTask({ id: 'core-test', description: 'List files', context: { workspace, userIntent: 'List files' }, createdAt: Date.now() }, { model: 'selected-model' })
    assert.equal(result.success, true)
    assert.deepEqual(progress, ['step_started', 'step_completed'])
    assert.deepEqual(requestedModels, ['selected-model', 'selected-model'])
    assert.ok(result.outputs[0].paths.includes('example.txt'), JSON.stringify(result.outputs[0]))
    assert.match(result.answer, /example\.txt/)
    const escaped = await core.getCapabilityRegistry().execute({ capability: 'file.read', args: { path: '../outside.txt' }, workspace }, new AbortController().signal)
    assert.equal(escaped.success, false)
    assert.match(escaped.error, /Path escapes workspace/)
  } finally {
    await core.dispose()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('Agent Core registers and removes MCP tools with the capability registry', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'myplane-mcp-'))
  const core = new AgentCoreService({
    dataDir: path.join(root, 'data'),
    skillsDir: path.join(root, 'skills'),
    getConnection: () => ({ endpoint: 'http://127.0.0.1:1/v1', key: '', maxTokens: 1024, contextLength: 8192 })
  })
  core.on('error', () => {})
  try {
    await core.initialize()
    await core.addMCPServer({ id: 'example', name: 'Example', command: process.execPath, args: [path.join(projectRoot, 'test-mcp-server.mjs')] })
    assert.ok(core.listCapabilities().some(item => item.name === 'mcp.example.echo'))
    const result = await core.getCapabilityRegistry().execute({ capability: 'mcp.example.echo', args: { message: 'hello' } }, new AbortController().signal)
    assert.equal(result.success, true)
    assert.match(JSON.stringify(result.output), /Echo: hello/)
    await core.removeMCPServer('example')
    assert.ok(!core.listCapabilities().some(item => item.name === 'mcp.example.echo'))
  } finally {
    await core.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

test('migrated Agent tools load as Skills and require approval for file writes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'myplane-tools-'))
  const skillsDir = path.join(root, 'skills')
  const workspace = path.join(root, 'workspace')
  mkdirSync(skillsDir)
  mkdirSync(workspace)
  cpSync(path.join(projectRoot, 'skills', 'agent-tools'), path.join(skillsDir, 'agent-tools'), { recursive: true })
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    const plan = { reasoning: 'Create a text file', steps: [{ capability: 'agent.write_file', args: { path: 'created.txt', content: 'from skill' } }] }
    const content = String(input.messages.at(-1)?.content).includes('工具结果') ? '文件已经创建。' : JSON.stringify(plan)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const core = new AgentCoreService({
    dataDir: path.join(root, 'data'), skillsDir,
    getConnection: () => ({ endpoint: `http://127.0.0.1:${address.port}/v1`, key: '', maxTokens: 1024, contextLength: 8192 })
  })
  core.on('error', () => {})
  try {
    await core.initialize()
    const tools = core.listCapabilities()
    assert.ok(tools.some(item => item.name === 'agent.git_status'))
    assert.ok(tools.some(item => item.name === 'agent.write_file' && item.tags.includes('requires-approval')))
    const task = id => ({ id, description: 'Create a file', context: { workspace, userIntent: 'Create a file' }, createdAt: Date.now() })
    const denied = await core.runTask(task('denied'), { model: 'test-model', maxReplanAttempts: 0 })
    assert.equal(denied.success, false)
    assert.equal((await import('node:fs')).existsSync(path.join(workspace, 'created.txt')), false)
    const approved = await core.runTask(task('approved'), { model: 'test-model', maxReplanAttempts: 0, approve: async (capability, args) => capability === 'agent.write_file' && args.path === 'created.txt' })
    assert.equal(approved.success, true, JSON.stringify(approved.errors))
    assert.equal((await import('node:fs')).readFileSync(path.join(workspace, 'created.txt'), 'utf8'), 'from skill')
    const adapter = new CoreWorkflowAdapter(async () => core, { projects: () => [] })
    const workflowResult = await new Promise(resolve => adapter.start({ projectless: true, workspace, mode: 'coding', model: 'test-model', prompt: 'Create a file', maxSteps: 2, approvalMode: 'auto' }, 0, resolve))
    assert.equal(workflowResult.status, 'completed', workflowResult.error)
    assert.equal((await import('node:fs')).readFileSync(path.join(workspace, 'created.txt'), 'utf8'), 'from skill')
  } finally {
    await core.dispose()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
