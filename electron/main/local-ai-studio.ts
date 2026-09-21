import {
  compactContext,
  contextMessages,
  contextStatus,
  needsCompaction,
  assertContextFits,
  isContextOverflow,
  inferenceBudget,
  type ContextMessage,
} from "./local-ai-context.js";
import { requestAgentModel, type AgentMessage } from "./agent/model.js";
import type { TokenUsage } from "../shared/local-ai-usage.js";
import {
  readTokenUsage,
  mergeTokenUsage,
  emptyTokenUsageTotals,
  updateTokenUsageTotals,
  sumTokenUsage,
} from "../shared/local-ai-usage.js";
import {
  app,
  BrowserWindow,
  dialog,
  net,
  shell,
  safeStorage,
  Notification,
  type WebContents,
  type IpcMainInvokeEvent,
} from "electron";
import {
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { LocalAiService } from "./local-ai.js";
import { LocalAiDownloads } from "./local-ai-downloads.js";
import { LocalAiRuntime } from "./local-ai-runtime.js";
import { LocalAiModelIcons } from "./local-ai-model-icons.js";
import {
  scanModelDirectory,
  mergeScannedModels,
} from "./local-ai-model-library.js";
import { LocalAiInstaller } from "./local-ai-installer.js";
import { LocalAiDeveloper } from "./local-ai-developer.js";
import { LocalAiGateway } from "./local-ai-gateway.js";
import type { RuntimeLoadOptions } from "../shared/local-ai-developer.js";
import {
  readIntegrationJson,
  writeIntegrationJson,
} from "./integration-store.js";
import { protectedHandle } from "./auth.js";
import {
  DEEPSEEK_CONTEXT_TOKENS,
  DEEPSEEK_DEFAULT_OUTPUT_TOKENS,
  isDeepSeek,
  deepseekThinking,
} from "../shared/local-ai-providers.js";
import {
  endpoint,
  formatModel,
  jsonResponse,
  modelFile,
  numeric,
  record,
  repoId,
  required,
  sseData,
  stableId,
  textValue,
} from "./local-ai-utils.js";
import type {
  StudioBootstrap,
  StudioCommands,
  StudioConnection,
  StudioEvent,
  StudioLocalModel,
  StudioMessage,
  StudioModelDetails,
  StudioModelFile,
  StudioSession,
  StudioSessionSummary,
  StudioSettings,
  StudioSettingsInput,
} from "../shared/local-ai-studio.js";
import {
  builtinCatalog,
  type StudioCatalog,
  type StudioDiscoveryModel,
} from "../shared/local-ai-catalog.js";
import { isVisionProjector } from "./local-ai-vision.js";
import { probeModel, modelProfile } from "./agent/probe.js";
import { AgentMcpManager } from "./agent/mcp.js";
import type { McpServerInput } from "../shared/local-ai-mcp.js";
import { LocalAgentService } from "./agent/service.js";
import { PythonToolRuntime } from "./agent/python.js";
import { AgentToolStore } from "./agent/tool-store.js";
import { AgentWorkspace } from "./agent/workspace.js";
import type {
  AgentMode,
  AgentApprovalMode,
  AgentTask,
} from "../shared/local-ai-agent.js";
import type { AgentToolSaveInput } from "../shared/local-ai-tools.js";
import {
  chatImages,
  chatMessageContent,
  maxSessionImageChars,
} from "../shared/local-ai-chat.js";
import { AutomationService } from "./agent/automation.js";
import type { AutomationTaskInput } from "../shared/local-ai-automation.js";
import { WorkflowService } from "./agent/workflow.js";
import type { WorkflowDefinitionInput } from "../shared/local-ai-workflow.js";

export type StudioLogSink = (
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  message: string,
) => void;
type OperationAudit = {
  scope: "local-service" | "remote-service" | "download" | "automation";
  label: string;
  target?: string;
};
const taskPreviewPaths = (task: AgentTask) => {
  const paths = new Set(task.artifacts.map((item) => item.path));
  for (const event of task.events) {
    if (event.preview?.path) paths.add(event.preview.path);
    for (const change of event.preview?.changes || []) paths.add(change.path);
    if (
      [
        "read_file",
        "read_document",
        "write_file",
        "replace_text",
        "create_document",
        "create_spreadsheet",
      ].includes(event.tool || "") &&
      typeof event.args?.path === "string"
    )
      paths.add(event.args.path);
  }
  return paths;
};
export class LocalAiStudioService extends LocalAiService {
  private preferences: Partial<StudioSettings> & {
    deepseekDefaultsVersion?: number;
  };
  private readonly preferencesFile: string;
  private readonly sessionsDirectory: string;
  private readonly downloads: LocalAiDownloads;
  private readonly runtime: LocalAiRuntime;
  private readonly chats = new Map<
    string,
    { owner: number; sessionId: string; controller: AbortController }
  >();
  private readonly metadata = new Map<
    string,
    { time: number; details: StudioModelDetails }
  >();
  private readonly catalogFile: string;
  private readonly modelIcons: LocalAiModelIcons;
  private readonly installer: LocalAiInstaller;
  private readonly developer: LocalAiDeveloper;
  private readonly gateway: LocalAiGateway;
  private readonly probes = new Map<number, AbortController>();
  private readonly probeFile: string;
  private readonly mcp: AgentMcpManager;
  private readonly agent: LocalAgentService;
  private readonly automation: AutomationService;
  private readonly workflow: WorkflowService;
  private readonly pythonTools: PythonToolRuntime;
  private readonly toolStore: AgentToolStore;
  private readonly agentWorkspaces = new Map<
    string,
    { owner: number; path: string }
  >();
  private readonly agentOwners = new Set<number>();
  private loadingRuntime = false;
  private stoppingServer = false;
  private catalogCache: Record<string, StudioCatalog> = {};
  constructor(
    dataRoot: string,
    private readonly applicationLog?: StudioLogSink,
  ) {
    const log = applicationLog;
    super(dataRoot);
    this.runtime = new LocalAiRuntime((level, message) =>
      log?.(level, "runtime", message),
    );
    this.preferencesFile = path.join(dataRoot, "local-ai-studio-settings.json");
    this.sessionsDirectory = path.join(dataRoot, "local-ai-sessions");
    this.preferences = readIntegrationJson<
      Partial<StudioSettings> & { deepseekDefaultsVersion?: number }
    >(this.preferencesFile, {});
    const saved = super.settings();
    if (
      isDeepSeek(saved.endpoint) &&
      this.preferences.deepseekDefaultsVersion !== 1
    ) {
      if (saved.maxTokens === 2048 || saved.maxTokens === 8192)
        super.saveSettings({ maxTokens: DEEPSEEK_DEFAULT_OUTPUT_TOKENS });
      // Existing DeepSeek installs used several smaller context defaults. Upgrade
      // every unversioned DeepSeek profile once; later explicit user choices stay.
      this.preferences.contextLength = DEEPSEEK_CONTEXT_TOKENS;
      this.preferences.deepseekDefaultsVersion = 1;
      writeIntegrationJson(this.preferencesFile, this.preferences);
    }
    this.catalogFile = path.join(dataRoot, "local-ai-catalog-cache.json");
    this.pythonTools = new PythonToolRuntime();
    this.toolStore = new AgentToolStore(
      path.join(dataRoot, "local-ai-tools.json"),
      this.pythonTools,
    );
    this.agent = new LocalAgentService(
      path.join(dataRoot, "local-ai-agent-tasks"),
      () => {
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
      (id) => this.mcp.specs(id),
      (id) => {
        const project = this.agent
          .projects()
          .find((project) => project.id === id);
        return this.toolStore.specs(project?.workspace || process.cwd());
      },
    );
    this.probeFile = path.join(dataRoot, "local-ai-model-profiles.json");
    this.mcp = new AgentMcpManager(
      path.join(dataRoot, "local-ai-mcp.json"),
      (id) => {
        const project = this.agent
          .projects()
          .find((project) => project.id === id);
        if (!project) throw new Error("项目不存在");
        new AgentWorkspace(project.workspace);
        return project;
      },
      (value) => {
        if (
          !safeStorage.isEncryptionAvailable() ||
          (process.platform === "linux" &&
            safeStorage.getSelectedStorageBackend() === "basic_text")
        )
          throw new Error("系统安全存储不可用，不能保存 MCP 凭据");
        return safeStorage.encryptString(value).toString("base64");
      },
      (value) => this.decrypt(value),
    );
    const notify = (title: string, body: string) => {
      if (!Notification.isSupported()) return false;
      new Notification({ title, body }).show();
      return true;
    };
    this.workflow = new WorkflowService(
      path.join(dataRoot, "local-ai-workflows"),
      this.agent,
      (level, message) => log?.(level, "workflow", message),
      notify,
      async () => {
        const settings = this.inferenceSettings();
        if (settings.source === "managed") return this.runtime.snapshot().modelName;
        const configured = (
          settings.model ||
          this.remoteProfiles()
            .filter((profile) => profile.endpoint === settings.endpoint)
            .sort((a, b) =>
              (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""),
            )[0]?.model ||
          ""
        );
        if (configured) return configured;
        const response = (await this.request(`${this.service().endpoint}/models`)) as {
          data?: { id?: unknown }[];
        };
        return (
          response.data
            ?.map((item) => textValue(item.id, 500))
            .find(Boolean) || ""
        );
      },
      () => this.inferenceSettings().source === "managed",
    );
    this.automation = new AutomationService(
      path.join(dataRoot, "local-ai-automations"),
      this.agent,
      (level, message) => log?.(level, "automation", message),
      notify,
      {
        exists: (id, projectId) =>
          this.workflow
            .definitions()
            .some(
              (item) =>
                item.id === id && item.projectId === projectId && item.enabled,
            ),
        start: (id, onUpdate) => this.workflow.start(id, onUpdate),
        cancel: (id) => {
          this.workflow.cancel(id);
        },
      },
    );
    this.modelIcons = new LocalAiModelIcons(
      path.join(dataRoot, "local-ai-model-icons"),
    );
    this.developer = new LocalAiDeveloper(dataRoot, (level, message) =>
      log?.(level, "developer-api", message),
    );
    this.installer = new LocalAiInstaller(
      path.join(dataRoot, "local-ai-runtimes"),
      (runtimePath) => this.saveStudioSettings({ runtimePath }),
    );
    try {
      const cache = readIntegrationJson<Record<string, StudioCatalog>>(
        this.catalogFile,
        {},
      );
      for (const [key, value] of Object.entries(record(cache)).slice(-20)) {
        const item = record(value);
        if (Array.isArray(item.models) && typeof item.updatedAt === "string")
          this.catalogCache[key] = value as StudioCatalog;
      }
    } catch {
      /* A disposable catalog cache must not prevent startup. */
    }
    this.downloads = new LocalAiDownloads(
      path.join(dataRoot, "local-ai-download-queue.json"),
      () => this.normalizeDownloadDirectory(),
      () => this.hfHeaders(),
      (entry) =>
        this.saveDownloads([
          entry,
          ...this.readDownloads().filter(
            (item) => item.localPath !== entry.localPath,
          ),
        ]),
      (url, options) => net.fetch(url, options),
      (level, message) => log?.(level, "download", message),
    );
    this.gateway = new LocalAiGateway(
      {
        models: () => this.models(),
        runtime: () => this.runtime.snapshot(),
        credential: () => this.runtime.apiKey,
        load: async (id, options) => {
          await this.startRuntime(id, options);
          return this.runtime.snapshot();
        },
        unload: () => this.runtime.stop(),
        files: (repo) => this.files(repo),
        enqueue: (repo, file) => this.enqueue({ repoId: repo, file }),
        downloads: () => this.downloads.list(),
      },
      path.join(dataRoot, "local-ai-api-download-jobs.json"),
      (level, message) => log?.(level, "local-api", message),
    );
  }
  studioSettings(): StudioSettings {
    const p = this.preferences,
      base = super.settings(),
      source = p.source === "managed" ? "managed" : "external",
      contextMaximum =
        source === "external" && isDeepSeek(base.endpoint)
          ? DEEPSEEK_CONTEXT_TOKENS
          : 131072;
    return {
      ...base,
      source,
      runtimePath: textValue(p.runtimePath, 2000),
      runtimePort: Math.round(numeric(p.runtimePort, 1024, 65535, 8089)),
      contextLength: Math.round(
        numeric(
          p.contextLength,
          512,
          contextMaximum,
          source === "external" && isDeepSeek(base.endpoint)
            ? DEEPSEEK_CONTEXT_TOKENS
            : 4096,
        ),
      ),
      gpuLayers: Math.round(numeric(p.gpuLayers, -1, 999, 0)),
      threads: Math.round(
        numeric(p.threads, 1, 256, Math.max(1, Math.min(8, os.cpus().length))),
      ),
      temperature: numeric(p.temperature, 0, 2, 0.7),
      topP: numeric(p.topP, 0.01, 1, 0.95),
      repeatPenalty: numeric(p.repeatPenalty, 0.1, 2, 1.1),
      systemPrompt: textValue(p.systemPrompt, 12000),
      theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
    };
  }
  private inferenceSettings(): StudioSettings {
    const settings = this.studioSettings(),
      runtime = this.runtime.snapshot();
    const contextLength =
      settings.source === "managed" &&
      runtime.contextLength &&
      ["running", "starting"].includes(runtime.state)
        ? Math.floor(runtime.contextLength / Math.max(1, runtime.parallel || 1))
        : settings.contextLength;
    return inferenceBudget({ ...settings, contextLength });
  }
  saveStudioSettings(input: unknown) {
    const value = record(input) as StudioSettingsInput,
      previous = this.studioSettings();
    if (value.endpoint !== undefined)
      endpoint(required(value.endpoint, "服务地址", 1000));
    if (
      value.downloadDirectory !== undefined &&
      !path.isAbsolute(value.downloadDirectory)
    )
      throw new Error("模型目录必须是绝对路径");
    const runtime = this.runtime.snapshot();
    if (
      this.gateway?.active &&
      value.runtimePort !== undefined &&
      value.runtimePort !== previous.runtimePort
    )
      throw new Error("请先停止 API 服务再修改端口");
    if (
      ["starting", "running", "stopping"].includes(runtime.state) &&
      ((value.runtimePort !== undefined &&
        value.runtimePort !== previous.runtimePort) ||
        (value.runtimePath !== undefined &&
          value.runtimePath !== previous.runtimePath))
    )
      throw new Error("请先卸载模型再修改运行文件或端口");
    super.saveSettings(value);
    const keys = [
      "source",
      "runtimePath",
      "runtimePort",
      "contextLength",
      "gpuLayers",
      "threads",
      "temperature",
      "topP",
      "repeatPenalty",
      "systemPrompt",
      "theme",
    ] as const;
    const candidate = { ...this.preferences };
    for (const key of keys)
      if (value[key] !== undefined)
        Object.assign(candidate, { [key]: value[key] });
    if (isDeepSeek(this.studioSettings().endpoint))
      candidate.deepseekDefaultsVersion = 1;
    writeIntegrationJson(this.preferencesFile, candidate);
    this.preferences = candidate;
    return this.studioSettings();
  }
  snapshot() {
    return {
      downloads: this.downloads.list(),
      runtime: this.runtimeSnapshot(),
      hardware: {
        platform: os.platform(),
        arch: os.arch(),
        cpu: os.cpus()[0]?.model || "CPU",
        threads: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
      },
    };
  }
  bootstrap(): StudioBootstrap {
    return {
      chatImagesSupported: true,
      ...this.snapshot(),
      settings: this.studioSettings(),
      models: this.models(),
      sessions: this.sessions(),
    };
  }
  private service() {
    const settings = this.studioSettings();
    if (settings.source === "managed") {
      return {
        apiFormat: "openai" as const,
        endpoint:
          this.gateway.endpoint ||
          `http://127.0.0.1:${settings.runtimePort}/v1`,
        key: this.gateway.apiKey,
      };
    }
    const config = this.config();
    return {
      apiFormat: config.apiFormat,
      endpoint: endpoint(config.endpoint),
      key: config.encryptedApiKey ? this.decrypt(config.encryptedApiKey) : "",
    };
  }
  private async request(url: string, body?: unknown, timeout = 15_000) {
    const service = this.service();
    return jsonResponse(
      await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(service.apiFormat === "anthropic"
            ? {
                "anthropic-version": "2023-06-01",
                ...(service.key ? { "x-api-key": service.key } : {}),
              }
            : service.key
              ? { Authorization: `Bearer ${service.key}` }
              : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeout),
      }),
    );
  }
  async connect(
    reason: "startup" | "manual" | "model-operation" = "manual",
  ): Promise<StudioConnection> {
    const service = this.service(),
      start = Date.now(),
      protocol = service.apiFormat === "anthropic" ? "Anthropic" : "OpenAI",
      endpoint = this.endpointLabel(service.endpoint);
    this.applicationLog?.(
      "info",
      "remote-service",
      `开始验证远程服务状态；原因=${reason}；协议=${protocol}；地址=${endpoint}`,
    );
    try {
      if (service.apiFormat === "anthropic" && !service.key)
        throw new Error("请先填写并保存 Anthropic API Key");
      if (
        service.apiFormat === "openai" &&
        isDeepSeek(service.endpoint) &&
        !service.key
      )
        throw new Error("请先填写并保存 DeepSeek API Key");
      const data = record(
        await this.request(`${service.endpoint}/models`, undefined, 7000),
      );
      if (!Array.isArray(data.data))
        throw new Error(
          `服务未返回有效的 ${service.apiFormat === "anthropic" ? "Anthropic" : "OpenAI"} 模型列表`,
        );
      let models = data.data
          .map((item) => record(item))
          .filter((item) => typeof item.id === "string")
          .map((item) => ({
            id: String(item.id),
            name: String(item.display_name || item.id),
            loaded: undefined as boolean | undefined,
            instanceId: undefined as string | undefined,
            contextLength: undefined as number | undefined,
          })),
        provider: StudioConnection["provider"] =
          service.apiFormat === "anthropic"
            ? "anthropic"
            : isDeepSeek(service.endpoint)
              ? "deepseek"
              : "openai";
      if (
        service.apiFormat === "openai" &&
        this.studioSettings().source === "external" &&
        !isDeepSeek(service.endpoint)
      ) {
        try {
          const native = record(
            await this.request(
              `${service.endpoint.replace(/\/v1$/, "")}/api/v1/models`,
              undefined,
              2500,
            ),
          );
          if (Array.isArray(native.models)) {
            provider = "lmstudio";
            models = native.models
              .map(record)
              .filter((item) => item.type === "llm")
              .map((item) => {
                const instances = Array.isArray(item.loaded_instances)
                  ? item.loaded_instances.map(record)
                  : [];
                const first = instances[0];
                return {
                  id: textValue(item.key) || textValue(item.id),
                  name: textValue(item.display_name) || textValue(item.key),
                  loaded: instances.length > 0,
                  instanceId: first ? textValue(first.id) : undefined,
                  contextLength:
                    Number(record(first?.config).context_length) || undefined,
                };
              })
              .filter((item) => item.id);
          }
        } catch {}
      }
      const latencyMs = Date.now() - start;
      this.applicationLog?.(
        "info",
        "remote-service",
        `远程服务验证成功；原因=${reason}；提供方=${provider}；模型数=${models.length}；耗时=${latencyMs}ms`,
      );
      return {
        ok: true,
        endpoint: service.endpoint,
        latencyMs,
        models,
        provider,
        error: "",
      };
    } catch (error) {
      const latencyMs = Date.now() - start,
        message = error instanceof Error ? error.message : String(error);
      this.applicationLog?.(
        "warn",
        "remote-service",
        `远程服务验证失败；原因=${reason}；协议=${protocol}；地址=${endpoint}；耗时=${latencyMs}ms；错误=${message}`,
      );
      return {
        ok: false,
        endpoint: service.endpoint,
        latencyMs,
        models: [],
        provider: service.apiFormat === "anthropic" ? "anthropic" : "openai",
        error: String(error),
      };
    }
  }
  private endpointLabel(value: string) {
    try {
      return new URL(value).origin;
    } catch {
      return "无效地址";
    }
  }
  private discoveryModel(value: unknown): StudioDiscoveryModel {
    const item = record(value),
      card = record(item.cardData),
      config = record(item.config),
      gguf = record(item.gguf),
      id = textValue(item.id) || textValue(item.modelId);
    const tags = Array.isArray(item.tags)
      ? item.tags
          .filter((tag): tag is string => typeof tag === "string")
          .slice(0, 80)
      : [];
    const pipelineTag = textValue(item.pipeline_tag),
      capabilities: string[] = [],
      pipelineDescriptions: Record<string, string> = {
        "text-generation": "文本生成与对话模型",
        "image-text-to-text": "图像与文本理解模型",
      };
    if (pipelineTag === "text-generation" || tags.includes("conversational"))
      capabilities.push("文本对话");
    if (
      ["image-text-to-text", "visual-question-answering"].includes(
        pipelineTag,
      ) ||
      tags.includes("vision")
    )
      capabilities.push("视觉");
    if (tags.some((tag) => ["reasoning", "chain-of-thought"].includes(tag)))
      capabilities.push("推理");
    if (
      tags.some((tag) =>
        ["tool-use", "function-calling", "tool-calling"].includes(tag),
      )
    )
      capabilities.push("工具调用");
    const parameters =
      Number(gguf.total) || Number(record(item.safetensors).total);
    return {
      id,
      author: textValue(item.author) || id.split("/")[0],
      likes: Number(item.likes) || 0,
      downloads: Number(item.downloads) || 0,
      tags,
      description:
        textValue(card.description, 500) ||
        textValue(item.description, 500) ||
        pipelineDescriptions[pipelineTag] ||
        "查看模型卡，了解模型用途、许可与使用方式。",
      pipelineTag,
      library: textValue(item.library_name),
      metricsKnown: true,
      lastModified:
        textValue(item.lastModified) || textValue(item.last_modified),
      parameterCount:
        Number.isFinite(parameters) && parameters > 0 ? parameters : undefined,
      architecture:
        textValue(gguf.architecture) ||
        textValue(config.model_type) ||
        textValue(
          Array.isArray(config.architectures)
            ? config.architectures[0]
            : undefined,
        ),
      capabilities,
      license:
        textValue(card.license) ||
        tags.find((tag) => tag.startsWith("license:"))?.slice(8) ||
        "",
    };
  }
  private catalogKey(input: unknown) {
    const value = record(input);
    return JSON.stringify([
      textValue(value.query, 160).trim().toLowerCase(),
      value.format === "all" ? "all" : "gguf",
      ["downloads", "likes", "lastModified"].includes(String(value.sort))
        ? String(value.sort)
        : "downloads",
    ]);
  }
  async catalog(input: unknown): Promise<StudioCatalog> {
    const value = record(input),
      key = this.catalogKey(input),
      cached = this.catalogCache[key];
    const fallback = (): StudioCatalog =>
      cached
        ? { ...cached, source: "cache", error: "" }
        : builtinCatalog(textValue(value.query, 160));
    if (value.cachedOnly === true) return fallback();
    try {
      const models = await this.search(input);
      if (!models.length && !textValue(value.query, 160).trim())
        throw new Error("模型目录暂未返回数据");
      const result: StudioCatalog = {
        models,
        source: "live",
        updatedAt: new Date().toISOString(),
        error: "",
      };
      delete this.catalogCache[key];
      this.catalogCache[key] = result;
      for (const old of Object.keys(this.catalogCache).slice(0, -20))
        delete this.catalogCache[old];
      try {
        writeIntegrationJson(this.catalogFile, this.catalogCache);
      } catch {
        /* Fresh results remain usable even when disk cache cannot be written. */
      }
      return result;
    } catch (cause) {
      return {
        ...fallback(),
        error: `暂时无法连接 Hugging Face。请检查网络或系统代理后重试；受限模型需要配置 Token。${String(cause).slice(0, 300)}`,
      };
    }
  }
  async search(input: unknown): Promise<StudioDiscoveryModel[]> {
    const value = record(input),
      params = new URLSearchParams({
        sort: ["downloads", "likes", "lastModified"].includes(
          String(value.sort),
        )
          ? String(value.sort)
          : "downloads",
        direction: "-1",
        limit: "40",
        full: "true",
        config: "true",
      });
    const query = textValue(value.query, 160).trim();
    if (query) params.set("search", query);
    if (value.format !== "all") params.set("filter", "gguf");
    const response = await jsonResponse(
      await net.fetch(`https://huggingface.co/api/models?${params}`, {
        headers: this.hfHeaders(),
        signal: AbortSignal.timeout(20000),
      }),
    );
    if (!Array.isArray(response))
      throw new Error("Hugging Face 返回的模型列表无效");
    return response
      .map((item) => this.discoveryModel(item))
      .filter((item) => item.id);
  }
  async modelDetails(id: string): Promise<StudioModelDetails> {
    const repo = repoId(id),
      cached = this.metadata.get(repo);
    if (cached && Date.now() - cached.time < 60_000) return cached.details;
    const data = record(
      await jsonResponse(
        await net.fetch(
          `https://huggingface.co/api/models/${repo.split("/").map(encodeURIComponent).join("/")}?blobs=true`,
          { headers: this.hfHeaders(), signal: AbortSignal.timeout(20000) },
        ),
      ),
    );
    if (!Array.isArray(data.siblings))
      throw new Error("模型文件列表为空或无权访问");
    const files = data.siblings
      .map(record)
      .map((item) => {
        const file = textValue(item.rfilename, 800),
          lfs = record(item.lfs);
        return {
          file,
          size: Number(item.size) || Number(lfs.size) || 0,
          type: "file",
          ...formatModel(file),
          revision: textValue(data.sha),
          sha256: /^[a-f\d]{64}$/i.test(textValue(lfs.sha256))
            ? textValue(lfs.sha256)
            : undefined,
        };
      })
      .filter((item) => item.file && !item.file.startsWith("."))
      .sort(
        (a, b) =>
          Number(b.format === "GGUF") - Number(a.format === "GGUF") ||
          a.file.localeCompare(b.file),
      );
    const contextLength =
      Number(record(data.gguf).context_length) ||
      Number(record(data.config).max_position_embeddings);
    const details: StudioModelDetails = {
      model: this.discoveryModel({ ...data, id: repo }),
      files,
      revision: textValue(data.sha),
      gated:
        data.gated === true ||
        (typeof data.gated === "string" && data.gated !== "false"),
      contextLength:
        Number.isFinite(contextLength) && contextLength > 0
          ? contextLength
          : undefined,
    };
    this.metadata.set(repo, { time: Date.now(), details });
    if (this.metadata.size > 30)
      this.metadata.delete(this.metadata.keys().next().value!);
    return details;
  }
  async files(id: string): Promise<StudioModelFile[]> {
    return (await this.modelDetails(id)).files;
  }
  async readme(id: string, revision: string) {
    const repo = repoId(id);
    if (!/^[a-f\d]{40,64}$/i.test(revision))
      throw new Error("无法确定模型卡版本");
    const response = await net.fetch(
      `https://huggingface.co/${repo.split("/").map(encodeURIComponent).join("/")}/raw/${revision}/README.md`,
      {
        headers: { ...this.hfHeaders(), Accept: "text/plain" },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (response.status === 404) return "";
    if (!response.ok)
      throw new Error(`模型卡读取失败：HTTP ${response.status}`);
    if (!response.body) return "";
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let content = "",
      truncated = false;
    try {
      while (true) {
        const part = await reader.read();
        content += decoder.decode(part.value, { stream: !part.done });
        if (content.length > 120000) {
          content = content.slice(0, 120000);
          truncated = true;
          break;
        }
        if (part.done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return (
      content
        .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
        .trim() +
      (truncated
        ? "\n\n模型卡较长，仅显示前部分内容。完整内容请在 Hugging Face 查看。"
        : "")
    );
  }
  async enqueue(input: unknown) {
    const value = record(input),
      repo = repoId(value.repoId),
      name = modelFile(value.file),
      files = await this.files(repo),
      file = files.find((item) => item.file === name);
    if (!file) throw new Error("该文件已不存在，请刷新模型列表");
    const split = name.match(/^(.*)-\d{5}-of-(\d{5})\.gguf$/i);
    const selected = split
      ? files.filter(
          (item) =>
            item.file.startsWith(`${split[1]}-`) &&
            item.file.endsWith(`-of-${split[2]}.gguf`),
        )
      : [file];
    if (split && selected.length !== Number(split[2]))
      throw new Error("分片模型不完整，无法下载");
    // A companion from this same repository revision enables vision at model load.
    const projectors = files.filter(
      (item) =>
        isVisionProjector(item.file) &&
        path.posix.dirname(item.file) === path.posix.dirname(name),
    );
    if (!isVisionProjector(name) && projectors.length === 1)
      selected.push(projectors[0]);
    return this.downloads.enqueue(repo, selected);
  }
  models(): StudioLocalModel[] {
    return this.readDownloads().map((entry) => ({
      ...entry,
      ...formatModel(entry.file),
      exists: existsSync(entry.localPath) && statSync(entry.localPath).isFile(),
    }));
  }
  async refreshModels(): Promise<StudioLocalModel[]> {
    const directory = this.studioSettings().downloadDirectory,
      found = await scanModelDirectory(directory);
    // Settings or downloads may change while the asynchronous traversal is running.
    if (this.studioSettings().downloadDirectory !== directory)
      return this.refreshModels();
    this.saveDownloads(mergeScannedModels(this.readDownloads(), found));
    return this.models();
  }
  importFiles(files: string[]) {
    const entries = this.readDownloads();
    for (const file of files) {
      const localPath = realpathSync(file),
        info = statSync(localPath);
      if (!info.isFile() || !localPath.toLowerCase().endsWith(".gguf"))
        throw new Error("请选择 GGUF 模型文件");
      if (entries.some((entry) => entry.localPath === localPath)) continue;
      entries.push({
        id: stableId(localPath),
        repoId: "本地导入",
        file: path.basename(localPath),
        localPath,
        size: info.size,
        downloadedAt: new Date().toISOString(),
        ...{ imported: true },
      });
    }
    this.saveDownloads(entries);
    return this.models();
  }
  removeModel(input: unknown) {
    const value = record(input),
      id = required(value.id, "模型 ID"),
      model = this.models().find((item) => item.id === id);
    if (!model) throw new Error("模型不存在");
    if (
      this.runtime.snapshot().modelId === id &&
      ["running", "starting", "stopping"].includes(
        this.runtime.snapshot().state,
      )
    )
      throw new Error("请先卸载该模型");
    if (value.deleteFile === true && model.exists) unlinkSync(model.localPath);
    this.saveDownloads(this.readDownloads().filter((item) => item.id !== id));
    return this.models();
  }
  revealModel(id: string) {
    const model = this.models().find((item) => item.id === id);
    if (!model?.exists) throw new Error("模型文件不存在");
    shell.showItemInFolder(model.localPath);
  }
  private runtimeSnapshot() {
    return {
      ...this.runtime.snapshot(),
      endpoint:
        this.gateway.endpoint ||
        `http://127.0.0.1:${this.studioSettings().runtimePort}/v1`,
    };
  }
  async startApiServer() {
    if (this.stoppingServer) throw new Error("API 服务正在停止，请稍后重试");
    this.saveStudioSettings({ source: "managed" });
    const settings = this.studioSettings();
    await this.gateway.start(
      this.developer.preferences().host,
      settings.runtimePort,
      this.developer.credential(),
    );
    return this.runtimeSnapshot();
  }
  async startRuntime(id: string, options: RuntimeLoadOptions = {}) {
    if (this.loadingRuntime || this.stoppingServer)
      throw new Error("运行时正在切换，请稍后重试");
    this.loadingRuntime = true;
    try {
      const model = this.models().find((item) => item.id === id);
      if (!model) throw new Error("模型不存在");
      if (
        /-\d{5}-of-\d{5}\.gguf$/i.test(model.file) &&
        !/-00001-of-\d{5}\.gguf$/i.test(model.file)
      )
        throw new Error("请加载分片模型的第一个文件（00001）");
      const state = this.runtime.snapshot();
      if (
        state.pid ||
        ["starting", "running", "stopping"].includes(state.state)
      )
        throw new Error("请先卸载当前模型，再加载其他模型");
      let runtimePath = this.studioSettings().runtimePath;
      if (!this.installer.valid(runtimePath))
        runtimePath = this.installer.detect(runtimePath)[0]?.path || "";
      if (!runtimePath)
        throw new Error(
          "未找到 llama-server。请打开“模型服务 > 本地服务 > 运行时”，安装官方运行包，或手动选择解压后的 llama-server（Windows 为 llama-server.exe）",
        );
      this.saveStudioSettings({ source: "managed", runtimePath });
      const settings = this.studioSettings(),
        preferences = this.developer.preferences();
      if (options.context_length !== undefined) {
        const total = options.context_length * preferences.parallel;
        if (!Number.isInteger(total) || total < 512 || total > 131072)
          throw new Error("上下文长度乘以并发槽数不能超过 131072");
        settings.contextLength = total;
      }
      await this.startApiServer();
      if (this.stoppingServer) throw new Error("API 服务正在停止");
      await this.runtime.start(
        settings,
        model,
        preferences,
        this.gateway.apiKey,
        options,
      );
      return this.runtimeSnapshot();
    } catch (error) {
      this.applicationLog?.(
        "error",
        "runtime",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      this.loadingRuntime = false;
    }
  }
  async stopRuntime() {
    this.stoppingServer = true;
    try {
      await this.gateway.stop();
      await this.runtime.stop();
      return this.runtimeSnapshot();
    } finally {
      this.stoppingServer = false;
    }
  }
  async loadExternal(input: unknown) {
    const value = record(input),
      id = required(value.id, "模型 ID"),
      service = this.service();
    if (this.studioSettings().source !== "external")
      throw new Error("请切换至外部服务");
    const status = await this.connect("model-operation");
    if (status.provider !== "lmstudio")
      throw new Error("当前服务不支持模型加载管理，请在服务端加载模型");
    await this.request(
      `${service.endpoint.replace(/\/v1$/, "")}/api/v1/models/${value.unload ? "unload" : "load"}`,
      value.unload
        ? { instance_id: id }
        : { model: id, context_length: this.studioSettings().contextLength },
      300_000,
    );
    return this.connect("model-operation");
  }
  private sessionFile(id: string) {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error("会话 ID 无效");
    return path.join(this.sessionsDirectory, `${id}.json`);
  }
  private saveSession(session: StudioSession) {
    session.updatedAt = new Date().toISOString();
    writeIntegrationJson(this.sessionFile(session.id), session);
    return session;
  }
  sessions(): StudioSessionSummary[] {
    if (!existsSync(this.sessionsDirectory)) return [];
    return readdirSync(this.sessionsDirectory)
      .filter((file) => /^[a-f\d-]{36}\.json$/i.test(file))
      .map((file) => this.session(file.slice(0, -5)))
      .map(({ messages, ...rest }) => ({
        ...rest,
        messageCount: messages.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  session(id: string): StudioSession {
    const file = this.sessionFile(id);
    if (!existsSync(file)) throw new Error("会话不存在");
    const session = readIntegrationJson<StudioSession>(
      file,
      {} as StudioSession,
    );
    if (session.id !== id || !Array.isArray(session.messages))
      throw new Error("会话文件格式错误");
    session.context = {
      ...this.chatContextStatus(session),
      state: session.context?.state || "ready",
      message: session.context?.message,
    };
    return session;
  }
  newSession() {
    const settings = this.studioSettings(),
      now = new Date().toISOString();
    return this.saveSession({
      usage: emptyTokenUsageTotals(),
      id: randomUUID(),
      title: "新对话",
      model:
        settings.source === "managed"
          ? this.runtime.snapshot().modelName
          : settings.model,
      systemPrompt: settings.systemPrompt,
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  updateSession(input: unknown) {
    const value = record(input),
      id = required(value.id, "会话 ID");
    if ([...this.chats.values()].some((item) => item.sessionId === id))
      throw new Error("请先停止生成再修改会话");
    const session = this.session(id);
    if (value.projectId !== undefined) {
      const id = textValue(value.projectId);
      if (id && !this.agent.projects().some((project) => project.id === id))
        throw new Error("项目不存在");
      session.projectId = id || undefined;
    }
    if (value.title !== undefined)
      session.title = required(value.title, "会话标题", 120);
    if (value.model !== undefined) session.model = textValue(value.model, 500);
    if (value.systemPrompt !== undefined)
      session.systemPrompt = textValue(value.systemPrompt, 12000);
    return this.saveSession(session);
  }
  deleteSession(id: string) {
    if ([...this.chats.values()].some((item) => item.sessionId === id))
      throw new Error("请先停止生成再删除会话");
    unlinkSync(this.sessionFile(id));
  }
  stopChat(requestId: string, owner: number) {
    const chat = this.chats.get(requestId);
    if (chat?.owner === owner) chat.controller.abort();
  }
  async startChat(input: unknown, sender: WebContents, compactOnly = false) {
    const value = record(input),
      requestId = required(value.requestId, "请求 ID", 100),
      session = this.session(required(value.sessionId, "会话 ID"));
    if (
      this.chats.has(requestId) ||
      [...this.chats.values()].some(
        (item) => item.owner === sender.id || item.sessionId === session.id,
      )
    )
      throw new Error("请先等待当前生成完成");
    const images =
      compactOnly || value.regenerate === true ? [] : chatImages(value.images);
    const imageChars = [
      ...session.messages.flatMap((message) => message.images || []),
      ...images,
    ].reduce((sum, image) => sum + image.dataUrl.length, 0);
    if (imageChars > maxSessionImageChars)
      throw new Error("当前会话的图片已达到容量上限，请新建对话");
    const model = required(value.model, "模型", 500),
      content = textValue(value.text, 100000).trim(),
      settings = this.inferenceSettings(),
      service = this.service();
    if (
      settings.source === "managed" &&
      this.runtime.snapshot().state !== "running"
    )
      throw new Error("请先在我的模型中加载模型，等待运行状态变为就绪");
    if (
      settings.source === "managed" &&
      !this.runtime.snapshot().vision &&
      (images.length ||
        session.messages.some((message) => message.images?.length))
    )
      throw new Error(
        "当前模型未加载视觉组件，无法接收图片。请下载该模型配套的 mmproj GGUF 文件，放在语言模型同一目录，然后卸载并重新加载模型。",
      );
    session.usage ??= sumTokenUsage(
      session.messages
        .filter((item) => item.role === "assistant")
        .map(
          (item) =>
            item.usage ||
            readTokenUsage({ usage: { completion_tokens: item.tokens } }),
        ),
    );
    if (!compactOnly) {
      if (value.regenerate === true) {
        if (session.messages.at(-1)?.role === "assistant")
          session.messages.pop();
        if (session.messages.at(-1)?.role !== "user")
          throw new Error("没有可重新生成的消息");
      } else {
        if (!content && !images.length) throw new Error("消息不能为空");
        session.messages.push({
          id: randomUUID(),
          role: "user",
          content,
          ...(images.length ? { images } : {}),
          createdAt: new Date().toISOString(),
        });
        if (session.title === "新对话")
          session.title = content.slice(0, 36) || "图片对话";
      }
    }
    if (
      session.checkpoint &&
      session.checkpoint.through > session.messages.length
    )
      delete session.checkpoint;
    session.model = model;
    this.saveSession(session);
    const controller = new AbortController();
    this.chats.set(requestId, {
      owner: sender.id,
      sessionId: session.id,
      controller,
    });
    const destroyed = () => controller.abort();
    sender.once("destroyed", destroyed);
    const emit = (event: StudioEvent) => {
      if (!sender.isDestroyed()) sender.send("local-ai:studio-event", event);
    };
    void this.generate(
      session,
      service,
      settings,
      controller.signal,
      emit,
      requestId,
      compactOnly,
    ).finally(() => {
      sender.removeListener("destroyed", destroyed);
      this.chats.delete(requestId);
    });
    return { started: true };
  }
  private chatHistory(session: StudioSession): ContextMessage[] {
    return session.messages.map((item) => ({
      role: item.role,
      content: chatMessageContent(item),
    }));
  }
  private chatSystem(session: StudioSession): ContextMessage[] {
    return session.systemPrompt
      ? [{ role: "system", content: session.systemPrompt }]
      : [];
  }
  private chatContextStatus(
    session: StudioSession,
    settings = this.inferenceSettings(),
  ) {
    return contextStatus(
      this.chatHistory(session),
      this.chatSystem(session),
      session.checkpoint,
      settings,
    );
  }
  private async prepareChatContext(
    session: StudioSession,
    service: {
      apiFormat: "openai" | "anthropic";
      endpoint: string;
      key: string;
    },
    settings: StudioSettings,
    signal: AbortSignal,
    emit: (event: StudioEvent) => void,
    requestId: string,
    force = false,
    aggressive = false,
  ) {
    const history = this.chatHistory(session),
      system = this.chatSystem(session),
      before = this.chatContextStatus(session, settings);
    session.context = before;
    const publish = () =>
      emit({
        type: "context",
        requestId,
        context: session.context!,
        sessionUsage: session.usage,
      });
    if (force || needsCompaction(before)) {
      session.context = {
        ...before,
        state: "compacting",
        message: "正在整理进度摘要…",
      };
      publish();
      try {
        const checkpoint = await compactContext({
          history,
          system,
          checkpoint: session.checkpoint,
          budget: settings,
          signal,
          force,
          aggressive,
          summarize: async (messages, maxTokens) => {
            session.usage!.requests++;
            let previous: TokenUsage | undefined;
            const answer = await requestAgentModel(
              {
                ...service,
                contextLength: settings.contextLength,
                maxTokens,
                localLlama: settings.source === "managed",
              },
              session.model,
              messages as AgentMessage[],
              signal,
              {
                tools: false,
                summary: true,
                onUsage: (usage) => {
                  updateTokenUsageTotals(session.usage!, previous, usage);
                  previous = usage;
                },
              },
            );
            return answer.content || "";
          },
        });
        signal.throwIfAborted();
        const previous = session.checkpoint,
          changed = previous !== checkpoint;
        session.checkpoint = checkpoint;
        session.context = {
          ...this.chatContextStatus(session, settings),
          message: changed
            ? "已压缩，可继续"
            : force
              ? "暂无可压缩的旧内容"
              : undefined,
        };
        try {
          this.saveSession(session);
        } catch (error) {
          session.checkpoint = previous;
          throw error;
        }
      } catch (error) {
        session.context = {
          ...before,
          state: "error",
          message: signal.aborted ? "压缩已停止，原记录已保留" : String(error),
        };
        publish();
        throw error;
      }
    }
    assertContextFits(session.context);
    publish();
    return contextMessages(history, system, session.checkpoint);
  }
  private async generate(
    session: StudioSession,
    service: {
      apiFormat: "openai" | "anthropic";
      endpoint: string;
      key: string;
    },
    settings: StudioSettings,
    signal: AbortSignal,
    emit: (event: StudioEvent) => void,
    requestId: string,
    compactOnly = false,
  ) {
    const started = Date.now(),
      answer: StudioMessage = {
        id: randomUUID(),
        role: "assistant",
        content: "",
        reasoning: "",
        createdAt: new Date().toISOString(),
        model: session.model,
        status: "complete",
      };
    let error = "";
    let lastSave = Date.now();
    const logScope =
      settings.source === "managed" ? "local-service" : "remote-service";
    this.applicationLog?.(
      "info",
      logScope,
      `${compactOnly ? "上下文压缩" : "模型推理"}开始；模型=${session.model}`,
    );
    const responseCharacterLimit = Math.min(
      8 * 1024 * 1024,
      Math.max(500000, settings.maxTokens * 8),
    );
    session.usage ??= emptyTokenUsageTotals();
    emit({
      type: "delta",
      requestId,
      content: "",
      reasoning: "",
      sessionUsage: session.usage,
    });
    try {
      this.saveSession(session);
      let messages = await this.prepareChatContext(
        session,
        service,
        settings,
        signal,
        emit,
        requestId,
        compactOnly,
      );
      if (compactOnly) return;
      if (service.apiFormat === "anthropic") {
        let previous: TokenUsage | undefined;
        const request = () => {
          session.usage!.requests++;
          return requestAgentModel(
            {
              ...service,
              contextLength: settings.contextLength,
              maxTokens: settings.maxTokens,
            },
            session.model,
            messages as AgentMessage[],
            signal,
            {
              tools: false,
              onContent: (content) => {
                answer.content += content;
                if (
                  answer.content.length + (answer.reasoning?.length || 0) >
                  responseCharacterLimit
                )
                  throw new Error("输出已达到应用单轮容量");
                emit({ type: "delta", requestId, content, reasoning: "" });
                if (Date.now() - lastSave > 2000) {
                  lastSave = Date.now();
                  this.saveSession(session);
                }
              },
              onReasoning: (reasoning) => {
                answer.reasoning = (answer.reasoning || "") + reasoning;
                if (
                  answer.content.length + (answer.reasoning?.length || 0) >
                  responseCharacterLimit
                )
                  throw new Error("输出已达到应用单轮容量");
                emit({ type: "delta", requestId, content: "", reasoning });
              },
              onUsage: (usage) => {
                updateTokenUsageTotals(session.usage!, previous, usage);
                previous = usage;
                answer.usage = usage;
                answer.tokens = usage.outputTokens;
                emit({
                  type: "delta",
                  requestId,
                  content: "",
                  reasoning: "",
                  usage,
                  sessionUsage: session.usage,
                });
              },
            },
          );
        };
        try {
          await request();
        } catch (cause) {
          if (signal.aborted || !isContextOverflow(cause)) throw cause;
          const checkpoint = session.checkpoint;
          messages = await this.prepareChatContext(
            session,
            service,
            settings,
            signal,
            emit,
            requestId,
            true,
            true,
          );
          if (checkpoint === session.checkpoint) throw cause;
          previous = undefined;
          await request();
        }
        if (!answer.content && !answer.reasoning)
          throw new Error("模型没有返回内容");
        session.messages.push(answer);
        return;
      }
      const request = async () => {
        session.usage!.requests++;
        const response = await fetch(`${service.endpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(service.key ? { Authorization: `Bearer ${service.key}` } : {}),
          },
          body: JSON.stringify({
            model: session.model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: settings.maxTokens,
            temperature: settings.temperature,
            top_p: settings.topP,
            ...(isDeepSeek(service.endpoint)
              ? deepseekThinking(service.endpoint)
              : { repeat_penalty: settings.repeatPenalty }),
          }),
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(30 * 60 * 1000),
          ]),
        });
        if (!response.ok) await jsonResponse(response);
        return response;
      };
      let response: Response;
      try {
        response = await request();
      } catch (cause) {
        if (signal.aborted || !isContextOverflow(cause)) throw cause;
        const previous = session.checkpoint;
        messages = await this.prepareChatContext(
          session,
          service,
          settings,
          signal,
          emit,
          requestId,
          true,
          true,
        );
        if (previous === session.checkpoint) throw cause;
        response = await request();
      }
      session.messages.push(answer);
      const accept = (data: unknown) => {
        const value = record(data);
        if (value.error)
          throw new Error(
            textValue(record(value.error).message) || "模型服务返回错误",
          );
        const first = record(
            Array.isArray(value.choices) ? value.choices[0] : undefined,
          ),
          delta = record(first.delta ?? first.message);
        const content = textValue(delta.content, responseCharacterLimit),
          reasoning = textValue(
            delta.reasoning_content ?? delta.reasoning,
            responseCharacterLimit,
          );
        answer.content += content;
        answer.reasoning = (answer.reasoning || "") + reasoning;
        if (
          answer.content.length + (answer.reasoning?.length || 0) >
          responseCharacterLimit
        )
          throw new Error("输出已达到应用单轮容量");
        const reported = readTokenUsage(value);
        if (reported) {
          const usage = mergeTokenUsage(answer.usage, reported);
          updateTokenUsageTotals(session.usage!, answer.usage, usage);
          answer.usage = usage;
          answer.tokens = usage.outputTokens;
        }
        if (content || reasoning || reported)
          emit({
            type: "delta",
            requestId,
            content,
            reasoning,
            ...(reported
              ? { usage: answer.usage, sessionUsage: session.usage }
              : {}),
          });
        if (Date.now() - lastSave > 2000) {
          lastSave = Date.now();
          this.saveSession(session);
        }
      };
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        if (!response.body) throw new Error("响应流为空");
        for await (const data of sseData(response.body, signal)) {
          if (data === "[DONE]") break;
          accept(JSON.parse(data));
        }
      } else accept(await response.json());
      if (!answer.content && !answer.reasoning)
        throw new Error("模型没有返回内容");
    } catch (cause) {
      if (signal.aborted) answer.status = "stopped";
      else {
        answer.status = "error";
        error = String(cause);
      }
    } finally {
      answer.elapsedMs = Date.now() - started;
      if (!compactOnly && !session.messages.includes(answer))
        session.messages.push(answer);
      if (session.context?.state !== "error")
        session.context = {
          ...this.chatContextStatus(session, settings),
          message: session.context?.message,
        };
      try {
        this.saveSession(session);
      } catch (cause) {
        error = `${error ? error + "；" : ""}保存会话失败：${String(cause)}`;
      }
      const outcome = signal.aborted ? "已停止" : error ? "失败" : "完成",
        message = `${compactOnly ? "上下文压缩" : "模型推理"}${outcome}；模型=${session.model}；耗时=${answer.elapsedMs}ms${error ? `；错误=${error}` : ""}`;
      this.applicationLog?.(
        error ? "error" : signal.aborted ? "warn" : "info",
        logScope,
        message,
      );
      emit({ type: "finished", requestId, session, error: error || undefined });
    }
  }
  async dispatch(
    action: string,
    input: unknown,
    event: IpcMainInvokeEvent,
  ): Promise<unknown> {
    const audit = this.operationAudit(action, input);
    if (!audit) return this.execute(action, input, event);
    const started = Date.now(),
      target = audit.target ? `；${audit.target}` : "";
    this.applicationLog?.("info", audit.scope, `${audit.label}：开始${target}`);
    try {
      const result = await this.execute(action, input, event);
      this.applicationLog?.(
        "info",
        audit.scope,
        `${audit.label}：完成；耗时=${Date.now() - started}ms`,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.applicationLog?.(
        "error",
        audit.scope,
        `${audit.label}：失败；耗时=${Date.now() - started}ms；错误=${message}`,
      );
      throw error;
    }
  }
  private operationAudit(
    action: string,
    input: unknown,
  ): OperationAudit | undefined {
    const value = record(input),
      text = (key: string, limit = 160) => textValue(value[key], limit),
      source =
        value.source === "managed"
          ? "本地服务"
          : value.source === "external"
            ? "远程服务"
            : this.studioSettings().source === "managed"
              ? "本地服务"
              : "远程服务";
    switch (action as keyof StudioCommands) {
      case "settings": {
        const hidden = new Set([
            "apiKey",
            "hfToken",
            "systemPrompt",
            "clearApiKey",
            "clearHfToken",
          ]),
          keys = Object.keys(value).filter((key) => !hidden.has(key));
        return {
          scope: source === "本地服务" ? "local-service" : "remote-service",
          label: "保存服务设置",
          target: `类型=${source}；变更=${keys.join(",") || "无"}`,
        };
      }
      case "remoteProfileSave":
        return {
          scope: "remote-service",
          label: "保存远程服务配置",
          target: `名称=${text("name", 80) || "未命名"}；协议=${text("apiFormat", 20) || "未指定"}；地址=${this.endpointLabel(text("endpoint", 1000))}`,
        };
      case "remoteProfileUse":
        return {
          scope: "remote-service",
          label: "切换远程服务配置",
          target: `配置=${text("id", 80)}`,
        };
      case "remoteProfileDelete":
        return {
          scope: "remote-service",
          label: "删除远程服务配置",
          target: `配置=${text("id", 80)}`,
        };
      case "loadExternal":
        return {
          scope: "remote-service",
          label: value.unload ? "卸载远程模型" : "加载远程模型",
          target: `模型=${text("id", 500)}`,
        };
      case "chat":
        return {
          scope: source === "本地服务" ? "local-service" : "remote-service",
          label: "提交模型推理",
          target: `类型=${source}；模型=${text("model", 500)}`,
        };
      case "compactSession":
        return {
          scope: source === "本地服务" ? "local-service" : "remote-service",
          label: "压缩对话上下文",
          target: `类型=${source}；模型=${text("model", 500)}`,
        };
      case "stopChat":
        return {
          scope: source === "本地服务" ? "local-service" : "remote-service",
          label: "停止模型推理",
        };
      case "search":
        return {
          scope: "download",
          label: "搜索模型",
          target: `格式=${text("format", 20) || "gguf"}；排序=${text("sort", 20) || "downloads"}`,
        };
      case "catalog":
        return {
          scope: "download",
          label:
            value.cachedOnly === true ? "读取模型目录缓存" : "刷新模型目录",
          target: `格式=${text("format", 20) || "gguf"}；排序=${text("sort", 20) || "downloads"}`,
        };
      case "modelDetails":
        return {
          scope: "download",
          label: "查看模型信息",
          target: `仓库=${text("repoId", 200)}`,
        };
      case "readme":
        return {
          scope: "download",
          label: "查看模型说明",
          target: `仓库=${text("repoId", 200)}`,
        };
      case "files":
        return {
          scope: "download",
          label: "查看模型文件",
          target: `仓库=${text("repoId", 200)}`,
        };
      case "enqueue":
        return {
          scope: "download",
          label: "添加模型下载",
          target: `仓库=${text("repoId", 200)}；文件=${text("file", 800)}`,
        };
      case "downloadAction": {
        const row = this.downloads
          .list()
          .find((item) => item.id === text("id", 100));
        return {
          scope: "download",
          label: "操作模型下载",
          target: `操作=${text("action", 20)}${row ? `；仓库=${row.repoId}；文件=${row.file}` : ""}`,
        };
      }
      case "importModels":
        return { scope: "download", label: "导入本地模型" };
      case "removeModel":
        return {
          scope: "download",
          label:
            value.deleteFile === true ? "删除本地模型文件" : "移除本地模型记录",
          target: `模型=${text("id", 100)}`,
        };
      case "revealModel":
        return {
          scope: "download",
          label: "在文件管理器中显示模型",
          target: `模型=${text("id", 100)}`,
        };
      case "chooseDirectory":
        return { scope: "download", label: "选择模型下载目录" };
      case "developerSettings":
        return {
          scope: "local-service",
          label: "保存本地服务设置",
          target: `变更=${
            Object.keys(value)
              .filter((key) => !["apiKey", "clearApiKey"].includes(key))
              .join(",") || "无"
          }`,
        };
      case "runtimeDetect":
        return { scope: "local-service", label: "检测本地运行时" };
      case "runtimePackages":
        return { scope: "local-service", label: "查询可用运行包" };
      case "runtimeInstall":
        return {
          scope: "local-service",
          label: "安装本地运行时",
          target: `运行包=${text("id", 100)}`,
        };
      case "runtimeInstallCancel":
        return { scope: "local-service", label: "取消安装本地运行时" };
      case "developerKey":
        return { scope: "local-service", label: "复制本地服务凭据" };
      case "developerRequest":
        return {
          scope: "local-service",
          label: "发送本地服务调试请求",
          target: `路由=${text("route", 200)}`,
        };
      case "developerCancelRequest":
        return { scope: "local-service", label: "取消本地服务调试请求" };
      case "developerClearLogs":
        return { scope: "local-service", label: "清空本地服务请求日志" };
      case "developerExportLogs":
        return { scope: "local-service", label: "导出本地服务日志" };
      case "startApiServer":
        return { scope: "local-service", label: "启动本地 API 服务" };
      case "unloadRuntime":
      case "stopRuntime":
        return { scope: "local-service", label: "停止本地模型服务" };
      case "startRuntime":
        return {
          scope: "local-service",
          label: "启动本地模型服务",
          target: `模型=${text("id", 100)}`,
        };
      case "chooseRuntime":
        return { scope: "local-service", label: "选择本地运行时" };
      case "automationSave":
        return {
          scope: "automation",
          label: "保存定时任务",
          target: `名称=${text("name", 100) || "未命名"}`,
        };
      case "automationDelete":
        return {
          scope: "automation",
          label: "删除定时任务",
          target: `任务=${text("id", 100)}`,
        };
      case "automationAction":
        return {
          scope: "automation",
          label: "操作定时任务",
          target: `任务=${text("id", 100)}；操作=${text("action", 20)}`,
        };
      case "workflowSave":
        return {
          scope: "automation",
          label: "保存工作流",
          target: `名称=${text("name", 100) || "未命名"}`,
        };
      case "workflowDelete":
        return {
          scope: "automation",
          label: "删除工作流",
          target: `工作流=${text("id", 100)}`,
        };
      case "workflowAction":
        return {
          scope: "automation",
          label: "操作工作流",
          target: `工作流=${text("id", 100)}；操作=${text("action", 20)}`,
        };
      case "workflowCancel":
        return {
          scope: "automation",
          label: "取消工作流运行",
          target: `运行=${text("runId", 100)}`,
        };
      case "workflowRetry":
        return {
          scope: "automation",
          label: "重试工作流节点",
          target: `运行=${text("runId", 100)}；节点=${text("nodeId", 100)}`,
        };
      case "workflowResolveApproval":
        return {
          scope: "automation",
          label: "处理工作流人工确认",
          target: `运行=${text("runId", 100)}；决定=${text("decision", 20)}`,
        };
      default:
        return undefined;
    }
  }
  private async execute(
    action: string,
    input: unknown,
    event: IpcMainInvokeEvent,
  ): Promise<unknown> {
    const value = record(input),
      owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) throw new Error("窗口不可用");
    switch (action as keyof StudioCommands) {
      case "workflowDefinitions":
        return this.workflow.definitions();
      case "workflowRuns":
        return this.workflow.runs(
          textValue(value.workflowId) || undefined,
          Number(value.limit) || 100,
        );
      case "workflowDelete": {
        const id = required(value.id, "工作流 ID");
        if (this.automation.tasks().some((task) => task.workflowId === id))
          throw new Error(
            "仍有定时任务引用此工作流，请先修改或删除相关定时任务",
          );
        return this.workflow.delete(id);
      }
      case "workflowCancel":
        return this.workflow.cancel(required(value.runId, "运行 ID"));
      case "workflowRetry":
        return this.workflow.retry(
          required(value.runId, "运行 ID"),
          required(value.nodeId, "节点 ID"),
        );
      case "workflowResolveApproval": {
        const decision = required(value.decision, "确认决定", 20);
        if (!["approved", "rejected"].includes(decision))
          throw new Error("确认决定无效");
        return this.workflow.resolveApproval(
          required(value.runId, "运行 ID"),
          decision as "approved" | "rejected",
        );
      }
      case "workflowAction": {
        const action = required(value.action, "操作", 20);
        if (!["run", "enable", "pause"].includes(action))
          throw new Error("工作流操作无效");
        return this.workflow.action(
          required(value.id, "工作流 ID"),
          action as "run" | "enable" | "pause",
        );
      }
      case "workflowSave": {
        const input = value as unknown as WorkflowDefinitionInput;
        if (
          input.nodes?.some(
            (node) =>
              node.type === "agent" &&
              ["auto", "full"].includes(node.config.approvalMode),
          )
        ) {
          const result = await dialog.showMessageBox(owner, {
            type: "warning",
            title: "允许工作流自动执行",
            message: "工作流包含无人值守 Agent 节点，是否保存？",
            detail:
              "节点只能使用项目现有权限。仍需人工确认的高风险操作会被拒绝，不会在后台永久等待。",
            buttons: ["取消", "保存"],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) throw new Error("已取消保存工作流");
        }
        return this.workflow.save(input);
      }
      case "automationTasks":
        return this.automation.tasks();
      case "automationTemplates":
        return this.automation.templates();
      case "automationRuns":
        return this.automation.runs(
          textValue(value.taskId) || undefined,
          Number(value.limit) || 100,
        );
      case "automationDelete":
        return this.automation.delete(required(value.id, "任务 ID"));
      case "automationAction": {
        const action = required(value.action, "操作", 20);
        if (!["enable", "pause", "run"].includes(action))
          throw new Error("定时任务操作无效");
        return this.automation.action(
          required(value.id, "任务 ID"),
          action as "enable" | "pause" | "run",
        );
      }
      case "automationSave": {
        const input = value as unknown as AutomationTaskInput,
          previous = input.id
            ? this.automation.tasks().find((item) => item.id === input.id)
            : undefined;
        if (
          ["auto", "full"].includes(input.agent?.approvalMode) &&
          previous?.agent.approvalMode !== input.agent.approvalMode
        ) {
          const result = await dialog.showMessageBox(owner, {
            type: "warning",
            title: "允许定时任务自动执行",
            message: "允许此任务在无人值守时自动执行可授权操作？",
            detail:
              "任务会使用项目现有的文件与联网权限。需要逐次确认的高风险操作会被拒绝，不会停在后台等待确认。",
            buttons: ["取消", "允许"],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) throw new Error("已取消保存定时任务");
        }
        return this.automation.save(input);
      }
      case "agentChooseWorkspace": {
        const pick = await dialog.showOpenDialog(owner, {
          title: "选择 Agent 可以读取和修改的项目 / 文档目录",
          properties: ["openDirectory", "createDirectory"],
        });
        if (pick.canceled) return null;
        const workspace = new AgentWorkspace(pick.filePaths[0]),
          token = randomUUID();
        this.agentWorkspaces.set(token, {
          owner: event.sender.id,
          path: workspace.root,
        });
        this.trackAgentOwner(event.sender);
        return { path: workspace.root, token };
      }
      case "agentModelProfile":
        return modelProfile(
          this.probeFile,
          this.service().endpoint,
          required(value.model, "模型", 500),
        );
      case "agentStopModelProbe":
        this.probes.get(event.sender.id)?.abort(new Error("测试已取消"));
        return;
      case "agentProbeModel": {
        if (
          value.kind !== undefined &&
          !["tools", "image"].includes(String(value.kind))
        )
          throw new Error("检测类型无效");
        if (this.probes.has(event.sender.id))
          throw new Error("模型测试正在进行");
        const controller = new AbortController(),
          stop = () => controller.abort();
        this.probes.set(event.sender.id, controller);
        event.sender.once("destroyed", stop);
        try {
          const settings = this.inferenceSettings();
          return await probeModel(
            this.probeFile,
            {
              ...this.service(),
              maxTokens: 256,
              contextLength: settings.contextLength,
            },
            required(value.model, "模型", 500),
            controller.signal,
            value.kind === "image" ? "image" : "tools",
          );
        } finally {
          this.probes.delete(event.sender.id);
          event.sender.removeListener("destroyed", stop);
        }
      }
      case "mcpServers":
        return this.mcp.list();
      case "mcpSave":
        return this.mcp.save(value as McpServerInput);
      case "mcpConnect": {
        const server = this.mcp.list().find((item) => item.id === value.id);
        if (!server) throw new Error("MCP 服务不存在");
        const result = await dialog.showMessageBox(owner, {
          type: "warning",
          title: "连接 MCP 服务",
          message: "连接 " + server.name + "？",
          detail:
            server.transport === "stdio"
              ? "将以当前用户权限启动：" +
                server.command +
                " " +
                (server.args || []).join(" ") +
                "。此服务未被系统沙箱隔离，可能访问文件和网络。"
              : "将连接 " + server.url + "。调用工具时参数会发送给该服务。",
          buttons: ["取消", "连接"],
          defaultId: 0,
          cancelId: 0,
        });
        return result.response === 1 ? this.mcp.connect(server.id) : null;
      }
      case "mcpDisconnect":
        return this.mcp.disconnect(required(value.id, "服务 ID"));
      case "mcpDelete":
        return this.mcp.remove(required(value.id, "服务 ID"));
      case "agentUpdateProject": {
        if (value.policy === "project-auto") {
          const result = await dialog.showMessageBox(owner, {
            type: "warning",
            title: "项目自动修改",
            message: "允许在选定范围内自动修改普通文本文件？",
            detail:
              "范围：" +
              JSON.stringify(value.autoWritePaths) +
              "。命令、测试脚本、敏感配置和 MCP 工具仍逐次确认。",
            buttons: ["取消", "允许"],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) throw new Error("已取消权限变更");
        }
        if (
          value.webAccess === "allow" &&
          this.agent.projects().find((project) => project.id === value.id)
            ?.webAccess !== "allow"
        ) {
          const result = await dialog.showMessageBox(owner, {
            type: "warning",
            title: "允许联网检索",
            message: "允许此项目的 Agent 无需逐次确认即可搜索和读取公网页面？",
            detail:
              "搜索词和要读取的 URL 会发送到外部服务。工具会拦截常见凭据、本机绝对路径、localhost、局域网和云元数据地址。",
            buttons: ["取消", "允许联网"],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) throw new Error("已取消联网权限变更");
        }
        if (
          value.webAllowSyntheticIp === true &&
          !this.agent.projects().find((project) => project.id === value.id)
            ?.webAllowSyntheticIp
        ) {
          const result = await dialog.showMessageBox(owner, {
            type: "warning",
            title: "兼容 fake-IP 代理",
            message: "允许联网工具访问 198.18.0.0/15 合成地址？",
            detail:
              "这会放宽该保留网段的 SSRF 防护。仅当本机正在使用 Clash 等可信透明代理的 fake-IP 模式时开启。其他本机、局域网和云元数据地址仍会被拦截。",
            buttons: ["取消", "开启兼容"],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) throw new Error("已取消 fake-IP 兼容设置");
        }
        return this.agent.updateProject(
          value as Parameters<LocalAgentService["updateProject"]>[0],
        );
      }
      case "agentResolveExecution": {
        const id = required(value.id, "任务 ID"),
          eventId = required(value.eventId, "步骤 ID"),
          task = this.agent.get(id),
          operation = task.events.find((item) => item.id === eventId);
        if (
          operation?.execution?.state !== "unknown" ||
          !["completed", "not-applied"].includes(String(value.outcome))
        )
          throw new Error("核对步骤或结果无效");
        const result = await dialog.showMessageBox(owner, {
          type: "warning",
          title: "核对中断操作",
          message:
            value.outcome === "completed"
              ? "确认此操作已经执行完成？"
              : "确认此操作尚未执行？",
          detail: `工具：${operation.tool}。${JSON.stringify(operation.args)}。此确认只记录你核对的结果，不会重新执行操作。`,
          buttons: ["取消", "确认核对结果"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return task;
        return this.agent.resolveExecution(
          id,
          eventId,
          value.outcome as "completed" | "not-applied",
          required(value.note, "核对说明", 1000),
        );
      }
      case "agentRestore": {
        const id = required(value.id, "任务 ID"),
          eventId = required(value.eventId, "修改 ID"),
          task = this.agent.get(id),
          change = task.events.find((event) => event.id === eventId);
        if (!change?.preview) throw new Error("修改记录不存在");
        const result = await dialog.showMessageBox(owner, {
          type: "warning",
          title: "恢复文件修改",
          message: "恢复这些文件到本次修改前？",
          detail:
            (
              change.preview.changes?.map((item) => item.path) || [
                change.preview.path,
              ]
            ).join("\n") +
            "\n本次新建的文件会删除。检测到后续修改时将拒绝恢复。",
          buttons: ["取消", "恢复"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return task;
        return this.agent.restore(id, eventId);
      }
      case "agentAudit":
        return this.agent.audit(required(value.id, "任务 ID"));
      case "agentEditProject":
        return this.agent.editProject({
          id: required(value.id, "项目 ID"),
          ...(value.name !== undefined
            ? { name: required(value.name, "项目名称", 80) }
            : {}),
          ...(value.pinned !== undefined
            ? { pinned: value.pinned as boolean }
            : {}),
        });
      case "agentRevealProject": {
        const project = this.agent
          .projects()
          .find((item) => item.id === required(value.id, "项目 ID"));
        if (!project) throw new Error("项目不存在");
        shell.showItemInFolder(new AgentWorkspace(project.workspace).root);
        return;
      }
      case "agentProjects":
        return this.agent.projects();
      case "agentCreateProject": {
        const grant = this.agentWorkspaces.get(textValue(value.workspaceToken));
        if (!grant || grant.owner !== event.sender.id)
          throw new Error("请通过选择目录按钮授权项目文件夹");
        return this.agent.createProject(
          grant.path,
          required(value.name, "项目名称", 80),
        );
      }
      case "agentTasks":
        return this.agent.list();
      case "agentTask":
        return this.agent.get(required(value.id, "任务 ID"));
      case "agentDelete":
        return this.agent.delete(required(value.id, "任务 ID"));
      case "agentToolsList":
        return this.toolStore.list();
      case "agentToolSave":
        return this.toolStore.save(value as unknown as AgentToolSaveInput);
      case "agentToolToggle":
        return this.toolStore.toggle(
          required(value.id, "工具 ID"),
          value.enabled === true,
        );
      case "agentToolRestore":
        return this.toolStore.restore(
          required(value.id, "工具 ID"),
          Number(value.version),
        );
      case "agentToolTest": {
        const project = this.agent
          .projects()
          .find((item) => item.id === required(value.projectId, "项目 ID"));
        if (!project) throw new Error("项目不存在");
        const found = this.toolStore.version(
            required(value.id, "工具 ID"),
            value.version === undefined ? undefined : Number(value.version),
          ),
          args = record(value.arguments);
        if (found.version.risk !== "read") {
          const answer = await dialog.showMessageBox(owner, {
            type: "warning",
            title: "测试 Python 工具",
            message: `运行 ${found.tool.key} v${found.version.version}？`,
            detail:
              "Python 工具以当前用户权限运行，可能修改文件、启动程序或访问网络。",
            buttons: ["取消", "运行"],
            defaultId: 0,
            cancelId: 0,
          });
          if (answer.response !== 1) throw new Error("已取消工具测试");
        }
        return this.pythonTools.execute(
          {
            tool: found.tool.key,
            args,
            workspace: project.workspace,
            code: found.version.python,
          },
          new AbortController().signal,
          found.version.timeoutMs,
        );
      }
      case "agentSteer": {
        const images = chatImages(value.images);
        if (
          this.studioSettings().source === "managed" &&
          !this.runtime.snapshot().vision &&
          images.length
        )
          throw new Error("当前模型未加载视觉组件，无法接收图片");
        return this.agent.steer(
          required(value.id, "任务 ID"),
          required(value.messageId, "消息 ID"),
          images.length
            ? textValue(value.prompt, 16000)
            : required(value.prompt, "调整要求", 16000),
          images,
          event.sender.id,
        );
      }
      case "agentStart": {
        const grant = this.agentWorkspaces.get(textValue(value.workspaceToken)),
          taskId = textValue(value.taskId),
          projectId = textValue(value.projectId);
        if (
          !taskId &&
          !projectId &&
          (!grant || grant.owner !== event.sender.id)
        )
          throw new Error("请通过选择目录按钮授权 Agent 工作目录");
        const sourceId = textValue(value.sessionId);
        if (
          sourceId &&
          [...this.chats.values()].some((chat) => chat.sessionId === sourceId)
        )
          throw new Error("请先停止当前对话");
        const seed = sourceId && !taskId ? this.session(sourceId) : undefined;
        if (
          seed &&
          this.agent.list().some((task) => task.sourceSessionId === seed.id)
        )
          throw new Error("此对话已转为任务，请从列表打开该任务继续");
        const images = chatImages(value.images);
        if (
          this.studioSettings().source === "managed" &&
          !this.runtime.snapshot().vision &&
          (images.length ||
            seed?.messages.some((message) => message.images?.length) ||
            (taskId &&
              this.agent
                .get(taskId)
                .events.some((event) => event.images?.length)))
        )
          throw new Error("当前模型未加载视觉组件，无法接收图片");
        this.trackAgentOwner(event.sender);
        return this.agent.start(
          {
            approvalMode: value.approvalMode as AgentApprovalMode | undefined,
            fastMode: value.fastMode !== false,
            tokenBudget: value.tokenBudget as number | undefined,
            seed,
            images,
            projectId: projectId || undefined,
            workspace: grant?.path,
            taskId: taskId || undefined,
            mode: value.mode as AgentMode,
            model: required(value.model, "模型", 500),
            prompt: images.length
              ? textValue(value.prompt, 16000)
              : required(value.prompt, "任务要求", 16000),
            maxSteps: Number(value.maxSteps),
          },
          event.sender.id,
          (task) => {
            if (!event.sender.isDestroyed())
              event.sender.send("local-ai:agent-event", task);
          },
        );
      }
      case "agentCompact": {
        this.trackAgentOwner(event.sender);
        return this.agent.compact(
          required(value.id, "任务 ID"),
          event.sender.id,
          (task) => {
            if (!event.sender.isDestroyed())
              event.sender.send("local-ai:agent-event", task);
          },
        );
      }
      case "agentStop":
        return this.agent.stop(required(value.id, "任务 ID"), event.sender.id);
      case "agentApprove":
        return this.agent.approve(
          required(value.id, "任务 ID"),
          required(value.eventId, "操作 ID"),
          value.approved as boolean,
          event.sender.id,
          value.scope as "once" | "similar" | undefined,
        );
      case "agentPreview": {
        const task = this.agent.get(required(value.id, "任务 ID")),
          relative = required(value.path, "文件路径", 2000);
        if (!taskPreviewPaths(task).has(relative))
          throw new Error("此文件未出现在当前任务记录中");
        const workspace = new AgentWorkspace(task.workspace),
          extension = path.extname(relative).toLowerCase(),
          language = extension.slice(1) || "text";
        let content = "",
          truncated = false,
          note = "";
        if ([".docx", ".xlsx", ".pdf"].includes(extension)) {
          const result = JSON.parse(
            await workspace.query(
              "read_document",
              { path: relative },
              new AbortController().signal,
            ),
          );
          content = result.text;
          truncated = result.nextOffset !== null;
          note = result.note || "";
        } else {
          const source = workspace.read(relative),
            limit = 300000;
          content = source.slice(0, limit);
          truncated = source.length > limit;
        }
        return { path: relative, content, language, truncated, note };
      }
      case "agentReveal": {
        const task = this.agent.get(required(value.id, "任务 ID")),
          relative = required(value.path, "文件路径", 2000);
        if (!task.artifacts.some((item) => item.path === relative))
          throw new Error("此文件不属于任务产物");
        shell.showItemInFolder(
          new AgentWorkspace(task.workspace).resolve(relative),
        );
        return;
      }
      case "bootstrap":
        return this.bootstrap();
      case "settings":
        return this.saveStudioSettings(input);
      case "remoteProfiles":
        return this.remoteProfiles();
      case "remoteProfileSave": {
        const result = this.remoteProfileSave(input),
          profile = value.id
            ? result.profiles.find((item) => item.id === value.id)
            : result.profiles.find(
                (item) =>
                  item.apiFormat === result.settings.apiFormat &&
                  item.endpoint === result.settings.endpoint &&
                  item.model === result.settings.model,
              );
        this.saveStudioSettings({
          apiFormat: result.settings.apiFormat,
          endpoint: result.settings.endpoint,
          model: result.settings.model,
          ...(profile ? { contextLength: profile.contextLength } : {}),
        });
        return { settings: this.studioSettings(), profiles: result.profiles };
      }
      case "remoteProfileUse": {
        const id = required(value.id, "配置 ID"),
          result = this.remoteProfileUse(id),
          profile = result.profiles.find((item) => item.id === id);
        this.saveStudioSettings({
          apiFormat: result.settings.apiFormat,
          endpoint: result.settings.endpoint,
          model: result.settings.model,
          ...(profile ? { contextLength: profile.contextLength } : {}),
        });
        return { settings: this.studioSettings(), profiles: result.profiles };
      }
      case "remoteProfileDelete":
        return this.remoteProfileDelete(required(value.id, "配置 ID"));
      case "snapshot":
        return this.snapshot();
      case "connect":
        return this.connect(value.reason === "startup" ? "startup" : "manual");
      case "search":
        return this.search(input);
      case "catalog":
        return this.catalog(input);
      case "modelDetails":
        return this.modelDetails(required(value.repoId, "模型仓库"));
      case "modelIcon":
        return this.modelIcons.get(required(value.author, "模型作者", 96));
      case "readme":
        return this.readme(
          required(value.repoId, "模型仓库"),
          required(value.revision, "模型版本"),
        );
      case "files":
        return this.files(required(value.repoId, "模型仓库"));
      case "enqueue":
        return this.enqueue(input);
      case "downloadAction":
        return this.downloads.action(
          required(value.id, "下载 ID"),
          required(value.action, "操作"),
        );
      case "models":
        return this.refreshModels();
      case "importModels": {
        const pick = await dialog.showOpenDialog(owner, {
          title: "导入 GGUF 模型（保留原文件位置）",
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "GGUF 模型", extensions: ["gguf"] }],
        });
        return pick.canceled ? this.models() : this.importFiles(pick.filePaths);
      }
      case "removeModel":
        return this.removeModel(input);
      case "revealModel":
        return this.revealModel(required(value.id, "模型 ID"));
      case "chooseDirectory": {
        const pick = await dialog.showOpenDialog(owner, {
          title: "选择模型下载目录",
          properties: ["openDirectory", "createDirectory"],
        });
        return pick.canceled ? null : pick.filePaths[0];
      }
      case "chooseRuntime": {
        const pick = await dialog.showOpenDialog(owner, {
          title: "选择完整运行包中的 llama-server（请保留配套动态库）",
          properties: ["openFile"],
          ...(process.platform === "win32"
            ? { filters: [{ name: "llama-server.exe", extensions: ["exe"] }] }
            : {}),
        });
        if (pick.canceled) return null;
        const file = pick.filePaths[0];
        if (!this.installer.valid(file))
          throw new Error(
            "请选择 llama-server.exe（macOS/Linux 为 llama-server），并确保具有执行权限，而不是 llama-cli、压缩包或源码文件",
          );
        return file;
      }
      case "developerState":
        return {
          preferences: this.developer.preferences(),
          installation: this.installer.snapshot(),
          runtimeFound: this.installer.valid(this.studioSettings().runtimePath),
          platform: process.platform,
          arch: process.arch,
          lanAddresses: this.developer.addresses(),
          requestLogs: [
            ...this.developer.requestLogs(),
            ...this.gateway.requestLogs(),
          ],
          serverRunning: this.gateway.running,
        };
      case "developerSettings": {
        const runtime = this.runtime.snapshot();
        if (
          this.gateway.active ||
          runtime.pid ||
          ["starting", "running", "stopping"].includes(runtime.state)
        )
          throw new Error("请先停止 API 服务再修改服务配置");
        return this.developer.save(input);
      }
      case "runtimeDetect":
        return this.installer.detect(this.studioSettings().runtimePath);
      case "runtimePackages":
        return this.installer.packages();
      case "runtimeInstall":
        return this.installer.install(required(value.id, "运行包 ID"));
      case "runtimeInstallCancel":
        return this.installer.cancel();
      case "developerKey":
        if (this.studioSettings().source !== "managed" || !this.gateway.running)
          throw new Error("请先启动托管 API 服务");
        return this.gateway.apiKey;
      case "developerRequest":
        return this.developer.request(input, this.service(), event.sender);
      case "developerCancelRequest":
        return this.developer.cancel(event.sender.id);
      case "developerClearLogs":
        this.runtime.clearLogs();
        this.developer.clearLogs();
        this.gateway.clearLogs();
        return;
      case "developerExportLogs": {
        const pick = await dialog.showSaveDialog(owner, {
          title: "导出本地服务日志（不包含 API Key）",
          defaultPath: "myplane-local-ai.log",
          filters: [{ name: "Log", extensions: ["log", "txt"] }],
        });
        if (pick.canceled || !pick.filePath) return false;
        writeFileSync(
          pick.filePath,
          [
            ...this.runtime.snapshot().logs,
            ...this.developer.requestLogs(),
            ...this.gateway.requestLogs(),
          ].join("\n"),
          "utf8",
        );
        return true;
      }
      case "startApiServer":
        return this.startApiServer();
      case "unloadRuntime":
        await this.gateway.unload();
        return this.runtimeSnapshot();
      case "startRuntime":
        return this.startRuntime(required(value.id, "模型 ID"));
      case "stopRuntime":
        return this.stopRuntime();
      case "loadExternal":
        return this.loadExternal(input);
      case "sessions":
        return this.sessions();
      case "session":
        return this.session(required(value.id, "会话 ID"));
      case "newSession":
        return this.newSession();
      case "updateSession":
        return this.updateSession(input);
      case "deleteSession":
        return this.deleteSession(required(value.id, "会话 ID"));
      case "exportSession": {
        const session = this.session(required(value.id, "会话 ID")),
          pick = await dialog.showSaveDialog(owner, {
            title: "导出对话",
            defaultPath:
              session.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") + ".md",
            filters: [
              { name: "Markdown", extensions: ["md"] },
              { name: "JSON", extensions: ["json"] },
            ],
          });
        if (pick.canceled || !pick.filePath) return false;
        const content = pick.filePath.endsWith(".json")
          ? JSON.stringify(session, null, 2)
          : `# ${session.title}\n\n模型：${session.model}\n\n${session.systemPrompt ? "## 系统提示词\n\n" + session.systemPrompt + "\n\n" : ""}${session.messages.map((message) => `## ${message.role === "user" ? "你" : "AI"}\n\n${message.content}${(message.images || []).map((image, index) => `\n\n![图片 ${index + 1}](${image.dataUrl})`).join("")}`).join("\n\n")}`;
        writeFileSync(pick.filePath, content, "utf8");
        return true;
      }
      case "chat":
        return this.startChat(input, event.sender);
      case "compactSession":
        return this.startChat(input, event.sender, true);
      case "stopChat":
        return this.stopChat(
          required(value.requestId, "请求 ID"),
          event.sender.id,
        );
      default:
        throw new Error("不支持的本地 AI 操作");
    }
  }
  private trackAgentOwner(sender: WebContents) {
    if (this.agentOwners.has(sender.id)) return;
    this.agentOwners.add(sender.id);
    sender.once("destroyed", () => {
      this.agent.stopOwner(sender.id);
      this.agentOwners.delete(sender.id);
      for (const [key, item] of this.agentWorkspaces)
        if (item.owner === sender.id) this.agentWorkspaces.delete(key);
    });
  }
  hasEnabledAutomations() {
    return this.automation.tasks().some((task) => task.enabled);
  }
  async dispose() {
    for (const probe of this.probes.values()) probe.abort();
    this.automation.dispose();
    this.workflow.dispose();
    this.agent.dispose();
    this.pythonTools.dispose();
    const mcpCleanup = this.mcp.dispose();
    for (const chat of this.chats.values()) chat.controller.abort();
    this.installer.dispose();
    this.developer.dispose();
    this.gateway.dispose();
    this.runtime.dispose();
    this.downloads.dispose();
    await mcpCleanup;
  }
}

export function registerLocalAiStudio(
  service: () => LocalAiStudioService,
  dispose: () => void | Promise<void>,
) {
  protectedHandle(
    "local-ai:studio",
    (event, action: unknown, input: unknown) =>
      service().dispatch(required(action, "操作", 40), input, event),
    true,
  );
  let closing = false,
    cleaned = false;
  app.on("before-quit", (event) => {
    if (cleaned) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    Promise.resolve()
      .then(dispose)
      .catch((error) => console.error("Local AI shutdown failed:", error))
      .finally(() => {
        cleaned = true;
        app.quit();
      });
  });
}
