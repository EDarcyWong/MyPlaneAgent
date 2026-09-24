/**
 * Mock Model Client - 用于测试时模拟 LLM 响应
 */

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ModelResponse = {
  content: string
  reasoning?: string
}

export type ModelConfig = {
  connection: any
  model: string
  temperature?: number
}

export class MockModelClient {
  private callCount = 0

  constructor(private config: ModelConfig) {}

  async complete(
    messages: ModelMessage[],
    signal?: AbortSignal,
    options?: { temperature?: number }
  ): Promise<ModelResponse> {
    this.callCount++

    // 提取用户消息内容
    const userMessage = messages.find(m => m.role === 'user')?.content || ''

    // 模拟 TypeScript 文件分析任务
    if (userMessage.includes('TypeScript') || userMessage.includes('electron/main/agent/core')) {
      return {
        content: JSON.stringify({
          reasoning: "分析 TypeScript 文件：先列出文件，再读取内容统计行数",
          steps: [
            {
              id: "step-1",
              capability: "file.list",
              args: { path: "electron/main/agent/core" },
              description: "列出核心目录的所有文件",
              dependsOn: []
            }
          ]
        })
      }
    }

    // 模拟 Skills 分析任务
    if (userMessage.includes('Skills') || userMessage.includes('skills/')) {
      return {
        content: JSON.stringify({
          reasoning: "分析 Skills 目录结构",
          steps: [
            {
              id: "step-1",
              capability: "file.list",
              args: { path: "skills" },
              description: "列出所有 Skills",
              dependsOn: []
            }
          ]
        })
      }
    }

    // 模拟 Git 分析任务
    if (userMessage.includes('Git') || userMessage.includes('git')) {
      return {
        content: JSON.stringify({
          reasoning: "分析 Git 仓库状态",
          steps: [
            {
              id: "step-1",
              capability: "git.status",
              args: { workspace: "." },
              description: "查看 git 状态",
              dependsOn: []
            },
            {
              id: "step-2",
              capability: "git.log",
              args: { workspace: ".", maxCount: 5 },
              description: "查看最近提交",
              dependsOn: []
            }
          ]
        })
      }
    }

    // 模拟报告生成任务
    if (userMessage.includes('报告') || userMessage.includes('report')) {
      return {
        content: JSON.stringify({
          reasoning: "生成分析报告文件",
          steps: [
            {
              id: "step-1",
              capability: "file.write",
              args: {
                path: "PROJECT_ANALYSIS.md",
                content: "# 项目分析报告\n\n分析完成"
              },
              description: "写入报告文件",
              dependsOn: []
            }
          ]
        })
      }
    }

    // 模拟规划响应（默认文件列表）
    if (userMessage.includes('Create an execution plan') || userMessage.includes('任务')) {
      return {
        content: JSON.stringify({
          reasoning: "执行文件列表任务",
          steps: [
            {
              id: "step-1",
              capability: "file.list",
              args: { path: "skills" },
              description: "列出 skills 目录",
              dependsOn: []
            }
          ]
        })
      }
    }

    // 模拟重新规划响应
    if (userMessage.includes('replan') || userMessage.includes('failed')) {
      return {
        content: JSON.stringify({
          reasoning: "调整计划以修复错误",
          steps: [
            {
              id: "step-1-retry",
              capability: "file.list",
              args: { path: "skills" },
              description: "重新列出 skills 目录",
              dependsOn: []
            }
          ]
        })
      }
    }

    // 默认规划响应
    return {
      content: JSON.stringify({
        reasoning: "执行简单的文件列表任务",
        steps: [
          {
            id: "step-default",
            capability: "file.list",
            args: { path: "." },
            description: "列出当前目录",
            dependsOn: []
          }
        ]
      })
    }
  }

  getCallCount(): number {
    return this.callCount
  }
}
