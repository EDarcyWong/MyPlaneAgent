/**
 * Skills 管理 IPC Handlers
 *
 * 添加到 local-ai-studio.ts 的 switch 语句中
 */

// 在 local-ai-studio.ts 中添加导入
import { SkillPlatform } from './agent/core/skill-platform.js'
import { PythonRuntimeManager } from './agent/core/python-runtime-manager.js'
import { promises as fs } from 'fs'

// 在 LocalAiStudio 类中添加属性
private skillPlatform: SkillPlatform | null = null
private runtimeManager: PythonRuntimeManager | null = null

// 在构造函数中初始化
async initializeSkills() {
  const dataDir = path.join(app.getPath('userData'), 'agent-data')
  const skillsDir = path.join(dataDir, 'skills')

  this.runtimeManager = new PythonRuntimeManager(dataDir)
  this.skillPlatform = new SkillPlatform(skillsDir, this.runtimeManager)
  await this.skillPlatform.initialize()
}

// 添加到 switch 语句的 case 中：

      // ============ Skills 管理 ============

      case "skillsList":
        if (!this.skillPlatform) {
          await this.initializeSkills()
        }
        return this.skillPlatform!.listSkills().map(skill => ({
          name: skill.name,
          displayName: skill.displayName,
          description: skill.description,
          version: skill.version,
          runtime: skill.runtime,
          category: skill.category,
          tools: skill.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          })),
          skillPath: skill.name,
          loaded: true,
          metadata: skill.metadata
        }))

      case "skillsReload":
        if (!this.skillPlatform) {
          await this.initializeSkills()
        }
        await this.skillPlatform!.initialize()
        return

      case "skillGetContent": {
        if (!this.skillPlatform) {
          await this.initializeSkills()
        }
        const skillName = required(value.skillName, "Skill 名称")
        const dataDir = path.join(app.getPath('userData'), 'agent-data')
        const skillDir = path.join(dataDir, 'skills', skillName)

        const [skillJsonRaw, indexPy, readme] = await Promise.all([
          fs.readFile(path.join(skillDir, 'skill.json'), 'utf-8'),
          fs.readFile(path.join(skillDir, 'index.py'), 'utf-8').catch(() => ''),
          fs.readFile(path.join(skillDir, 'README.md'), 'utf-8').catch(() => '')
        ])

        return {
          skillJson: JSON.parse(skillJsonRaw),
          indexPy,
          readme
        }
      }

      case "skillSave": {
        if (!this.skillPlatform) {
          await this.initializeSkills()
        }
        const skillName = required(value.skillName, "Skill 名称")
        const skillJson = record(value.skillJson)
        const indexPy = textValue(value.indexPy, 100000)
        const readme = textValue(value.readme, 50000)

        const dataDir = path.join(app.getPath('userData'), 'agent-data')
        const skillDir = path.join(dataDir, 'skills', skillName)

        // 保存文件
        await Promise.all([
          fs.writeFile(
            path.join(skillDir, 'skill.json'),
            JSON.stringify(skillJson, null, 2),
            'utf-8'
          ),
          fs.writeFile(
            path.join(skillDir, 'index.py'),
            indexPy,
            'utf-8'
          ),
          fs.writeFile(
            path.join(skillDir, 'README.md'),
            readme,
            'utf-8'
          )
        ])

        // 重新加载
        await this.skillPlatform!.initialize()
        return
      }

      case "skillTestTool": {
        if (!this.skillPlatform) {
          await this.initializeSkills()
        }
        const skillName = required(value.skillName, "Skill 名称")
        const toolName = required(value.toolName, "工具名称")
        const args = record(value.args)
        const workspace = textValue(value.workspace, 1000)

        const startTime = Date.now()

        // 执行工具
        const result = await this.runtimeManager!.executeTool(
          skillName,
          toolName,
          args,
          { workspace },
          new AbortController().signal
        )

        return {
          output: JSON.stringify(result),
          elapsedMs: Date.now() - startTime
        }
      }

      case "skillCreate": {
        if (!this.skillPlatform) {
          await this.initializeSkills()
        }
        const skillName = required(value.skillName, "Skill 名称")

        if (!/^[a-z][a-z0-9-]{0,63}$/.test(skillName)) {
          throw new Error('Skill 标识需以小写字母开头，只能包含小写字母、数字、连字符')
        }

        const dataDir = path.join(app.getPath('userData'), 'agent-data')
        const skillDir = path.join(dataDir, 'skills', skillName)

        // 检查是否已存在
        if (existsSync(skillDir)) {
          throw new Error('Skill 已存在')
        }

        // 创建目录
        await fs.mkdir(skillDir, { recursive: true })

        // 创建默认文件
        const defaultSkillJson = {
          name: skillName,
          displayName: skillName,
          description: '新 Skill',
          version: '1.0.0',
          runtime: 'python-native',
          category: 'general',
          tools: [
            {
              name: `${skillName}_tool`,
              description: '工具描述',
              inputSchema: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false
              }
            }
          ]
        }

        const defaultIndexPy = `"""
${skillName}

新创建的 Skill
"""

def ${skillName}_tool(args, context):
    """
    工具实现

    Args:
        args: 输入参数
        context: 执行上下文（包含 workspace 等）

    Returns:
        执行结果（可 JSON 序列化的对象）
    """
    return {
        "message": "Hello from ${skillName}",
        "args": args
    }

# 工具映射（必需）
TOOLS = {
    '${skillName}_tool': ${skillName}_tool
}
`

        const defaultReadme = `# ${skillName}

新创建的 Skill

## 工具

- \`${skillName}_tool\`: 工具描述

## 使用方法

通过 Agent 自动调用或直接调用。
`

        await Promise.all([
          fs.writeFile(
            path.join(skillDir, 'skill.json'),
            JSON.stringify(defaultSkillJson, null, 2),
            'utf-8'
          ),
          fs.writeFile(
            path.join(skillDir, 'index.py'),
            defaultIndexPy,
            'utf-8'
          ),
          fs.writeFile(
            path.join(skillDir, 'README.md'),
            defaultReadme,
            'utf-8'
          )
        ])

        await this.skillPlatform!.initialize()
        return
      }

      case "getDefaultWorkspace": {
        const projects = this.agent.projects()
        if (projects.length > 0) {
          return projects[0].workspace
        }
        return os.homedir()
      }
