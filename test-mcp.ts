/**
 * 测试 MCP Client 和 Adapter
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MCPClient } from './electron/main/agent/core/mcp-client.js'
import { MCPAdapter } from './electron/main/agent/core/mcp-adapter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = __dirname

async function testMCPClient() {
  console.log('\n=== Test 1: MCP Client ===\n')

  const client = new MCPClient({
    id: 'example',
    name: 'Example MCP Server',
    command: 'node',
    args: [path.join(projectRoot, 'test-mcp-server.mjs')]
  })

  try {
    // 连接
    await client.connect()
    console.log('✓ Connected to MCP server')

    // 获取工具列表
    const tools = client.getTools()
    console.log(`✓ Found ${tools.length} tools:`)
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description}`)
    }

    // 调用 echo 工具
    console.log('\n调用 echo 工具:')
    const echoResult = await client.callTool('echo', { message: 'Hello MCP!' })
    console.log(`✓ Result: ${echoResult}`)

    // 调用 add 工具
    console.log('\n调用 add 工具:')
    const addResult = await client.callTool('add', { a: 10, b: 32 })
    console.log(`✓ Result: ${addResult}`)

    // 转换为 Capabilities
    console.log('\n转换为 Capabilities:')
    const capabilities = client.toCapabilities()
    console.log(`✓ Generated ${capabilities.length} capabilities:`)
    for (const cap of capabilities) {
      console.log(`  - ${cap.name} (${cap.category})`)
    }

    await client.disconnect()
    console.log('\n✓ MCP Client 测试通过')
    return true

  } catch (error) {
    console.error('✗ MCP Client 测试失败:', error)
    await client.disconnect()
    return false
  }
}

async function testMCPAdapter() {
  console.log('\n=== Test 2: MCP Adapter ===\n')

  const adapter = new MCPAdapter()

  try {
    // 添加服务器
    await adapter.addServer({
      id: 'example',
      name: 'Example MCP Server',
      command: 'node',
      args: [path.join(projectRoot, 'test-mcp-server.mjs')]
    })
    console.log('✓ Server added')

    // 获取所有 Capabilities
    const capabilities = adapter.getAllCapabilities()
    console.log(`✓ Loaded ${capabilities.length} capabilities:`)
    for (const cap of capabilities) {
      console.log(`  - ${cap.name}: ${cap.description}`)
    }

    // 执行 echo
    console.log('\n执行 mcp.example.echo:')
    const controller = new AbortController()
    const echoResult = await adapter.execute(
      {
        capability: 'mcp.example.echo',
        args: { message: 'Hello from Adapter!' },
        workspace: projectRoot
      },
      controller.signal
    )

    if (echoResult.success) {
      console.log(`✓ Success: ${echoResult.output}`)
      console.log(`  耗时: ${echoResult.elapsedMs}ms`)
    } else {
      console.error(`✗ Failed: ${echoResult.error}`)
    }

    // 执行 add
    console.log('\n执行 mcp.example.add:')
    const addResult = await adapter.execute(
      {
        capability: 'mcp.example.add',
        args: { a: 25, b: 17 },
        workspace: projectRoot
      },
      controller.signal
    )

    if (addResult.success) {
      console.log(`✓ Success: ${addResult.output}`)
      console.log(`  耗时: ${addResult.elapsedMs}ms`)
    } else {
      console.error(`✗ Failed: ${addResult.error}`)
    }

    // 统计信息
    console.log('\n统计信息:')
    const stats = adapter.getStats()
    console.log(`  总服务器数: ${stats.totalServers}`)
    console.log(`  总工具数: ${stats.totalTools}`)
    console.log(`  各服务器工具数:`, stats.byServer)

    await adapter.disconnectAll()
    console.log('\n✓ MCP Adapter 测试通过')
    return true

  } catch (error) {
    console.error('✗ MCP Adapter 测试失败:', error)
    console.error(error)
    await adapter.disconnectAll()
    return false
  }
}

async function runTests() {
  console.log('🚀 开始 MCP 测试...')

  const results = {
    client: await testMCPClient(),
    adapter: await testMCPAdapter()
  }

  console.log('\n' + '='.repeat(50))
  console.log('测试结果汇总:')
  console.log('='.repeat(50))
  console.log('MCP Client:', results.client ? '✓' : '✗')
  console.log('MCP Adapter:', results.adapter ? '✓' : '✗')

  const allPassed = Object.values(results).every(r => r)
  console.log('\n总体结果:', allPassed ? '✓ 全部通过' : '✗ 部分失败')

  process.exit(allPassed ? 0 : 1)
}

runTests().catch(error => {
  console.error('测试运行失败:', error)
  process.exit(1)
})
