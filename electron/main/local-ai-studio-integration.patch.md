/**
 * Local AI Studio Integration Patch
 * 展示如何将新的 Agent Core 架构集成到 LocalAiStudioService
 *
 * 主要修改点：
 * 1. 添加 AgentCoreService 实例
 * 2. 在构造函数中初始化
 * 3. 添加新的 IPC 处理程序
 * 4. 保持向后兼容
 */

// ============================================
// 1. 导入新模块（在文件顶部添加）
// ============================================

import { AgentCoreService } from './agent/agent-core-service.js'
import type { AgentEvent } from '../shared/types/index.js'

// ============================================
// 2. 在 LocalAiStudioService 类中添加属性
// ============================================

export class LocalAiStudioService extends LocalAiService {
  // ... 现有属性 ...

  private skillPlatform: SkillPlatform | null = null;
  private runtimeManager: PythonRuntimeManager | null = null;

  // 新增：Agent Core Service
  private agentCoreService: AgentCoreService | null = null;
  private agentCoreEnabled = false; // 功能开关

  // ... 其他属性 ...
}

// ============================================
// 3. 修改构造函数，初始化 Agent Core Service
// ============================================

constructor(
  dataRoot: string,
  private readonly applicationLog?: StudioLogSink,
) {
  const log = applicationLog;
  super(dataRoot);

  // ... 现有初始化代码 ...

  // 新增：初始化 Agent Core Service（可选功能）
  try {
    const agentCoreConfig = {
      dataDir: path.join(dataRoot, 'agent-core'),
      skillsDir: path.join(dataRoot, 'skills'),
      getConnection: () => {
        const settings = this.inferenceSettings();
        if (
          settings.source === "managed" &&
          this.runtime.snapshot().state !== "running"
        )
          throw new Error("请先加载支持工具调用的本地模型");
        return {
          ...this.service(),
          maxTokens: settings.maxTokens,
          contextLength: settings.contextLength,
          localLlama: settings.source === "managed",
        };
      },
      diagnosticLog: message => log?.("error", "agent-core", message)
    };

    this.agentCoreService = new AgentCoreService(agentCoreConfig);

    // 设置事件监听
    this.agentCoreService.on('agent-event', ({ taskId, event }) => {
      this.emitAgentCoreEvent(taskId, event);
    });

    this.agentCoreService.on('error', (error) => {
      log?.('error', 'agent-core', String(error));
    });

    // 异步初始化（不阻塞构造函数）
    this.initializeAgentCore();

  } catch (error) {
    log?.('warn', 'agent-core', `Agent Core 初始化失败: ${error}`);
    this.agentCoreService = null;
  }
}

// ============================================
// 4. 添加异步初始化方法
// ============================================

private async initializeAgentCore() {
  if (!this.agentCoreService) return;

  try {
    await this.agentCoreService.initialize();
    this.agentCoreEnabled = true;
    this.applicationLog?.('info', 'agent-core', 'Agent Core 已就绪');
  } catch (error) {
    this.applicationLog?.('error', 'agent-core', `初始化失败: ${error}`);
    this.agentCoreEnabled = false;
  }
}

// ============================================
// 5. 添加事件转发方法
// ============================================

private emitAgentCoreEvent(taskId: string, event: AgentEvent) {
  // 将 Agent Core 事件转发到前端
  this.agentOwners.forEach(owner => {
    this.window(owner)?.webContents.send('agent-core-event', {
      taskId,
      event
    });
  });
}

// ============================================
// 6. 添加新的 IPC 处理方法
// ============================================

/**
 * 获取 Agent Core 状态
 */
agentCoreStatus() {
  if (!this.agentCoreService) {
    return { enabled: false, available: false };
  }

  return {
    enabled: this.agentCoreEnabled,
    available: true,
    ...this.agentCoreService.getStatus()
  };
}

/**
 * 使用新架构运行任务
 */
async agentCoreRunTask(
  taskId: string,
  description: string,
  options: {
    projectId?: string;
    mode?: 'general' | 'coding' | 'documents';
    workspace?: string;
  }
) {
  if (!this.agentCoreService || !this.agentCoreEnabled) {
    throw new Error('Agent Core 未启用，请使用传统模式');
  }

  const task = {
    id: taskId,
    description,
    context: {
      workspace: options.workspace || process.cwd()
    },
    createdAt: Date.now()
  };

  await this.agentCoreService.runTask(task, {
    projectId: options.projectId,
    mode: options.mode || 'general'
  });
}

/**
 * 取消任务
 */
agentCoreCancelTask(taskId: string) {
  if (!this.agentCoreService) {
    throw new Error('Agent Core 未启用');
  }

  this.agentCoreService.cancelTask(taskId);
}

/**
 * 列出所有能力
 */
agentCoreListCapabilities() {
  if (!this.agentCoreService) {
    return [];
  }

  return this.agentCoreService.listCapabilities();
}

/**
 * 列出所有 Skills
 */
agentCoreListSkills() {
  if (!this.agentCoreService) {
    return [];
  }

  return this.agentCoreService.listSkills();
}

/**
 * 添加 MCP 服务器
 */
async agentCoreAddMCPServer(config: {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}) {
  if (!this.agentCoreService) {
    throw new Error('Agent Core 未启用');
  }

  await this.agentCoreService.addMCPServer(config);
}

/**
 * 移除 MCP 服务器
 */
async agentCoreRemoveMCPServer(id: string) {
  if (!this.agentCoreService) {
    throw new Error('Agent Core 未启用');
  }

  await this.agentCoreService.removeMCPServer(id);
}

// ============================================
// 7. 在 dispose 方法中清理资源
// ============================================

async dispose() {
  // ... 现有清理代码 ...

  // 新增：清理 Agent Core Service
  if (this.agentCoreService) {
    try {
      await this.agentCoreService.dispose();
    } catch (error) {
      this.applicationLog?.('error', 'agent-core', `清理失败: ${error}`);
    }
  }
}

// ============================================
// 8. 注册 IPC 处理程序（在 registerLocalAiStudio 函数中添加）
// ============================================

export function registerLocalAiStudio(
  service: LocalAiStudioService,
  window: BrowserWindow
): () => void {
  // ... 现有注册代码 ...

  // 新增：Agent Core IPC 处理
  const agentCoreHandlers: [string, (event: IpcMainInvokeEvent, ...args: any[]) => any][] = [
    ['agent-core-status', () => service.agentCoreStatus()],
    ['agent-core-run-task', (e, taskId, description, options) =>
      service.agentCoreRunTask(taskId, description, options)],
    ['agent-core-cancel-task', (e, taskId) =>
      service.agentCoreCancelTask(taskId)],
    ['agent-core-list-capabilities', () =>
      service.agentCoreListCapabilities()],
    ['agent-core-list-skills', () =>
      service.agentCoreListSkills()],
    ['agent-core-add-mcp-server', (e, config) =>
      service.agentCoreAddMCPServer(config)],
    ['agent-core-remove-mcp-server', (e, id) =>
      service.agentCoreRemoveMCPServer(id)],
  ];

  for (const [channel, handler] of agentCoreHandlers) {
    ipcMain.handle(channel, handler);
  }

  return () => {
    // ... 现有清理代码 ...

    // 移除 Agent Core 处理程序
    for (const [channel] of agentCoreHandlers) {
      ipcMain.removeHandler(channel);
    }
  };
}

// ============================================
// 使用说明
// ============================================

/**
 * 集成步骤：
 *
 * 1. 将上述代码集成到 local-ai-studio.ts
 * 2. 添加类型定义到 electron/shared/types/index.ts
 * 3. 在前端添加对应的 API 调用
 * 4. 创建新的界面组件来展示 Agent Core 功能
 *
 * 向后兼容性：
 * - agentCoreEnabled 标志控制是否使用新架构
 * - 如果初始化失败，自动回退到旧的 LocalAgentService
 * - 前端可以检查 agent-core-status 来决定使用哪个 API
 *
 * 渐进式迁移：
 * - 第一阶段：两套系统并存，用户可选择
 * - 第二阶段：默认使用新系统，保留旧系统作为后备
 * - 第三阶段：完全移除旧系统
 */
