/**
 * Skill 类型定义
 * 定义 Skill 的元数据、能力、权限等
 */

/**
 * Skill 运行时配置
 */
export type SkillRuntime = {
  type: 'python' | 'nodejs'
  version: string          // 最低版本要求，如 ">=3.9"
  entry: string            // 入口文件，如 "index.py"
  venv: boolean           // 是否使用虚拟环境
}

/**
 * Tool 定义
 */
export type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema
  returns?: Record<string, unknown>
  risk?: 'read' | 'write' | 'high'
  examples?: Array<{
    input: Record<string, unknown>
    output: unknown
  }>
}

/**
 * Workflow 定义
 */
export type WorkflowDefinition = {
  name: string
  description: string
  steps: string[]          // Tool 名称序列
}

/**
 * Prompt 定义
 */
export type PromptDefinition = {
  name: string
  template: string         // 模板字符串，支持 {{variable}}
  variables?: string[]
}

/**
 * Skill 能力声明
 */
export type SkillCapabilities = {
  tools?: ToolDefinition[]
  workflows?: WorkflowDefinition[]
  prompts?: PromptDefinition[]
  resources?: Record<string, string>  // 静态资源路径映射
}

/**
 * Skill 权限声明
 */
export type SkillPermissions = {
  fileSystem?: {
    read?: string[]        // glob 模式
    write?: string[]
  }
  network?: boolean
  process?: boolean
}

/**
 * Skill 依赖
 */
export type SkillDependencies = {
  python?: string[]                    // pip 包列表
  npm?: Record<string, string>         // npm 包映射
  skills?: string[]                    // 依赖的其他 Skill ID
  mcp?: {
    required?: string[]                // 必需的 MCP 服务
    optional?: string[]                // 可选的 MCP 服务
  }
}

/**
 * Skill 元数据（skill.json）
 */
export type SkillManifest = {
  id: string                           // kebab-case，如 "file-operations"
  name: string                         // 显示名称
  version: string                      // 语义化版本
  category: string                     // 分类：file/git/browser/coding/...
  description: string
  enabled?: boolean
  author?: string
  icon?: string
  homepage?: string

  runtime: SkillRuntime
  capabilities: SkillCapabilities
  permissions: SkillPermissions
  dependencies: SkillDependencies
}

/**
 * Skill 实例（运行时状态）
 */
export type SkillInstance = {
  manifest: SkillManifest
  path: string                         // 安装路径
  enabled: boolean
  installedAt: string                  // ISO 8601
  updatedAt: string

  // 运行时状态
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  workerId?: string                    // Python Worker ID
}

/**
 * Skill 安装选项
 */
export type SkillInstallOptions = {
  enable?: boolean                     // 安装后立即启用
  force?: boolean                      // 强制覆盖已存在的 Skill
}

/**
 * Skill 安装来源
 */
export type SkillSource =
  | { type: 'local'; path: string }
  | { type: 'git'; url: string; branch?: string }
  | { type: 'npm'; package: string; version?: string }
  | { type: 'marketplace'; id: string; version?: string }
