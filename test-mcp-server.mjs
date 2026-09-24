#!/usr/bin/env node
/**
 * 简单的 MCP 服务器示例
 * 用于测试 MCP Client
 */

import { createInterface } from 'node:readline'

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

// 模拟工具
const tools = [
  {
    name: 'echo',
    description: '回显输入的文本',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '要回显的消息' }
      },
      required: ['message']
    }
  },
  {
    name: 'add',
    description: '计算两个数的和',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: '第一个数' },
        b: { type: 'number', description: '第二个数' }
      },
      required: ['a', 'b']
    }
  }
]

// 处理消息
rl.on('line', (line) => {
  try {
    const message = JSON.parse(line)
    const response = handleMessage(message)
    console.log(JSON.stringify(response))
  } catch (error) {
    console.error('Parse error:', error)
  }
})

function handleMessage(message) {
  const { id, method, params } = message

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'example-mcp-server',
          version: '1.0.0'
        }
      }
    }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools
      }
    }
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params

    if (name === 'echo') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Echo: ${args.message}`
            }
          ]
        }
      }
    }

    if (name === 'add') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Result: ${args.a + args.b}`
            }
          ]
        }
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Tool not found: ${name}`
      }
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`
    }
  }
}

console.error('Example MCP server started')
