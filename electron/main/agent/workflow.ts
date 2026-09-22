import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  readIntegrationJson,
  writeIntegrationJson,
} from "../integration-store.js";
import type { AgentTask } from "../../shared/local-ai-agent.js";
import type { AgentConnection } from "./model.js";
import type {
  WorkflowBranch,
  WorkflowDefinition,
  WorkflowDefinitionInput,
  WorkflowModelRef,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowRun,
} from "../../shared/local-ai-workflow.js";
import { LocalAgentService } from "./service.js";

const now = () => new Date().toISOString();
const text = (value: unknown, label: string, max: number, optional = false) => {
  const result = String(value ?? "").trim();
  if ((!result && !optional) || result.length > max)
    throw new Error(`${label}需要 ${optional ? "0" : "1"}–${max} 个字符`);
  return result;
};
const integer = (value: unknown, label: string, min: number, max: number) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${label}需要 ${min}–${max} 的整数`);
  return result;
};
type WorkflowModelPlan = {
  model: string;
  source?: "current" | "local" | "remote";
  label?: string;
  connection?: AgentConnection;
};

export class WorkflowService {
  private readonly definitionsFile: string;
  private readonly versionsFile: string;
  private readonly runsFile: string;
  private readonly callbacks = new Map<string, (run: WorkflowRun) => void>();
  private readonly activeAgents = new Map<string, string>();
  private readonly pendingLocalAgents: { definition: WorkflowDefinition; runId: string; nodeId: string }[] = [];
  private readonly timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    directory: string,
    private agent: LocalAgentService,
    private log?: (level: "info" | "warn" | "error", message: string) => void,
    private notify?: (title: string, body: string) => void | boolean,
    private currentModel?: () => string | Promise<string>,
    private isLocalModel?: () => boolean,
    private prepareModel?: (
      ref: WorkflowModelRef | undefined,
      legacyModel: string | undefined,
    ) => Promise<WorkflowModelPlan>,
  ) {
    this.definitionsFile = path.join(directory, "definitions.json");
    this.versionsFile = path.join(directory, "versions.json");
    this.runsFile = path.join(directory, "runs.json");
    this.recover();
  }
  private modelRef(input: unknown, label: string): WorkflowModelRef | undefined {
    if (!input || typeof input !== "object") return;
    const row = input as Record<string, unknown>,
      source = row.source;
    if (source === "current")
      return {
        source,
        ...(typeof row.id === "string" && row.id.trim()
          ? { id: text(row.id, `${label} ID`, 500) }
          : {}),
        ...(typeof row.name === "string" && row.name.trim()
          ? { name: text(row.name, `${label}名称`, 500) }
          : {}),
      };
    if (source === "local")
      return {
        source,
        id: text(row.id, `${label} ID`, 500),
        ...(typeof row.name === "string" && row.name.trim()
          ? { name: text(row.name, `${label}名称`, 500) }
          : {}),
      };
    if (source === "remote") {
      const apiFormat = row.apiFormat === "anthropic" ? "anthropic" : "openai",
        endpoint = text(row.endpoint, `${label}服务地址`, 1000);
      try {
        const url = new URL(endpoint);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new Error(`${label}服务地址无效`);
      }
      return {
        source,
        id: text(row.id, `${label} ID`, 500),
        apiFormat,
        endpoint: endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint,
        ...(typeof row.name === "string" && row.name.trim()
          ? { name: text(row.name, `${label}名称`, 500) }
          : {}),
        ...(typeof row.profileId === "string" && row.profileId.trim()
          ? { profileId: text(row.profileId, `${label}配置`, 100) }
          : {}),
        ...(Number.isFinite(Number(row.contextLength))
          ? {
              contextLength: integer(
                row.contextLength,
                `${label}上下文`,
                512,
                1_000_000,
              ),
            }
          : {}),
      };
    }
    throw new Error(`${label}来源无效`);
  }
  definitions() {
    const rows = readIntegrationJson<WorkflowDefinition[]>(
      this.definitionsFile,
      [],
    );
    if (!Array.isArray(rows)) throw new Error("工作流定义记录已损坏");
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  runs(workflowId?: string, limit = 100) {
    const rows = readIntegrationJson<WorkflowRun[]>(this.runsFile, []);
    if (!Array.isArray(rows)) throw new Error("工作流运行记录已损坏");
    return rows
      .filter((row) => !workflowId || row.workflowId === workflowId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, Math.max(1, Math.min(2000, limit)));
  }
  private writeDefinitions(rows: WorkflowDefinition[]) {
    writeIntegrationJson(this.definitionsFile, rows);
  }
  private writeRuns(rows: WorkflowRun[]) {
    writeIntegrationJson(
      this.runsFile,
      [...rows]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .slice(-2000),
    );
  }
  private node(input: WorkflowNode, ids: Set<string>): WorkflowNode {
    const name = text(input.name, "节点名称", 100),
      legacyBranches: WorkflowBranch[] = [
        ...(input.onSuccess
          ? [
              {
                id: "success",
                name: "成功",
                condition: "执行成功",
                color: "#4a9a6e",
                targetNodeId: input.onSuccess,
              },
            ]
          : []),
        ...(input.onFailure
          ? [
              {
                id: "failure",
                name: "失败",
                condition: "执行失败",
                color: "#c65a52",
                targetNodeId: input.onFailure,
              },
            ]
          : []),
      ],
      sourceBranches = Array.isArray(input.branches)
        ? input.branches
        : legacyBranches;
    const aiBranchMode =
        input.type === "agent" && input.config?.branchMode === "ai",
      branchIds = new Set<string>(),
      branches = sourceBranches.map((branch, index) => {
        const id = text(
            branch.id,
            `节点“${name}”第 ${index + 1} 条分支 ID`,
            80,
          ),
          branchName = text(
            branch.name,
            `节点“${name}”第 ${index + 1} 条分支名称`,
            80,
          ),
          condition = text(
            branch.condition,
            `节点“${name}”分支“${branchName}”的判断条件`,
            500,
          ),
          color = String(branch.color || "").trim();
        if (branchIds.has(id))
          throw new Error(`节点“${name}”的分支 ID 不能重复`);
        branchIds.add(id);
        if (!/^#[0-9a-f]{6}$/i.test(color))
          throw new Error(`节点“${name}”分支“${branchName}”的颜色无效`);
        if (!aiBranchMode)
          this.validateBranchCondition(condition, name, branchName);
        const rawTargets = Array.isArray(branch.targetNodeIds)
            ? branch.targetNodeIds
            : branch.targetNodeId
              ? [branch.targetNodeId]
              : [],
          targetNodeIds = [
            ...new Set(
              rawTargets.map((target) =>
                text(target, `节点“${name}”分支“${branchName}”的输出目标`, 80),
              ),
            ),
          ];
        if (
          targetNodeIds.some(
            (target) => !ids.has(target) || target === input.id,
          )
        )
          throw new Error(`节点“${name}”分支“${branchName}”的输出目标无效`);
        const outputValue = text(
          branch.outputValue,
          `节点“${name}”分支“${branchName}”的输出值`,
          4000,
          true,
        );
        return {
          id,
          name: branchName,
          condition,
          color,
          ...(targetNodeIds.length ? { targetNodeIds } : {}),
          ...(outputValue ? { outputValue } : {}),
        };
      });
    const base = { id: text(input.id, "节点 ID", 80), name, branches };
    if (input.type === "agent") {
      const branchMode = input.config?.branchMode || "ai",
        modelRef = this.modelRef(input.config?.modelRef, `节点“${base.name}”的模型`),
        modelSource =
          input.config?.modelSource ||
          (input.config?.model || (modelRef && modelRef.source !== "current")
            ? "specified"
            : "current");
      if (
        !["general", "coding", "documents"].includes(input.config?.mode) ||
        !["ask", "auto", "full", "unrestricted"].includes(
          input.config?.approvalMode,
        ) ||
        !["all", "any"].includes(input.config?.inputSignalMode || "all") ||
        !["ai", "rules"].includes(branchMode) ||
        !["current", "specified"].includes(modelSource) ||
        (modelSource === "specified" &&
          !String(input.config?.model || modelRef?.id || "").trim())
      )
        throw new Error(`节点“${base.name}”的 Agent 配置无效`);
      const inputNames = new Set<string>(),
        inputs = (
          Array.isArray(input.config.inputs) ? input.config.inputs : []
        ).map((parameter, index) => {
          const parameterName = text(
              parameter.name,
              `节点“${base.name}”第 ${index + 1} 个输入参数名称`,
              100,
            ),
            legacy = parameter as unknown as {
              description?: unknown;
              value?: unknown;
            },
            description = text(
              legacy.description ?? legacy.value,
              `输入参数“${parameterName}”的说明`,
              4000,
              true,
            ),
            value = text(
              legacy.value,
              `输入参数“${parameterName}”的绑定值`,
              4000,
              true,
            );
          if (inputNames.has(parameterName))
            throw new Error(`节点“${base.name}”的输入参数名称不能重复`);
          inputNames.add(parameterName);
          return { name: parameterName, description, ...(value ? { value } : {}) };
        });
      if (branchMode === "ai") {
        if (!branches.length)
          throw new Error(`Agent“${base.name}”至少需要一个输出分支`);
        for (const branch of branches)
          this.outputTemplate(
            branch.outputValue,
            `Agent“${base.name}”分支“${branch.name}”的输出 JSON`,
          );
      }
      return {
        ...base,
        type: "agent",
        config: {
          instruction: text(input.config.instruction, "Agent 要求", 16000),
          ...(input.config.model
            ? { model: text(input.config.model, "模型", 500) }
            : {}),
          ...(modelRef ? { modelRef } : {}),
          modelSource,
          mode: input.config.mode,
          maxSteps: integer(input.config.maxSteps, "最大步骤", 1, 500),
          fastMode: input.config.fastMode !== false,
          approvalMode: input.config.approvalMode,
          inputs,
          inputSignalMode: input.config.inputSignalMode || "all",
          branchMode,
        },
      };
    }
    if (input.type === "condition") {
      const sourceNodeId = text(input.config?.sourceNodeId, "条件来源节点", 80);
      if (
        !ids.has(sourceNodeId) ||
        !["succeeded", "failed"].includes(input.config?.operator)
      )
        throw new Error(`节点“${base.name}”的条件配置无效`);
      return {
        ...base,
        type: "condition",
        config: { sourceNodeId, operator: input.config.operator },
      };
    }
    if (input.type === "route") {
      const sourceNodeId = text(input.config?.sourceNodeId, "路由来源节点", 80);
      if (!ids.has(sourceNodeId))
        throw new Error(`节点“${base.name}”的路由来源无效`);
      return { ...base, type: "route", config: { sourceNodeId } };
    }
    if (input.type === "data") {
      const names = new Set<string>(),
        assignments = (
          Array.isArray(input.config?.assignments)
            ? input.config.assignments
            : []
        ).map((assignment, index) => {
          const assignmentName = text(
              assignment.name,
              `节点“${base.name}”第 ${index + 1} 个变量名`,
              80,
            ),
            value = text(
              assignment.value,
              `变量“${assignmentName}”的值`,
              4000,
              true,
            );
          if (names.has(assignmentName))
            throw new Error(`节点“${base.name}”的变量名不能重复`);
          names.add(assignmentName);
          return { name: assignmentName, value };
        });
      if (!assignments.length)
        throw new Error(`节点“${base.name}”至少需要设置一个变量`);
      return { ...base, type: "data", config: { assignments } };
    }
    if (input.type === "join") {
      if (!["all", "any"].includes(input.config?.mode))
        throw new Error(`节点“${base.name}”的汇合方式无效`);
      return { ...base, type: "join", config: { mode: input.config.mode } };
    }
    if (input.type === "approval")
      return {
        ...base,
        type: "approval",
        config: {
          prompt: text(input.config?.prompt, "确认内容", 1000),
          approveLabel: text(input.config?.approveLabel, "批准按钮文字", 30),
          rejectLabel: text(input.config?.rejectLabel, "拒绝按钮文字", 30),
        },
      };
    if (input.type === "notify")
      return {
        ...base,
        type: "notify",
        config: {
          title: text(input.config?.title, "通知标题", 120),
          body: text(input.config?.body, "通知内容", 1000),
        },
      };
    if (input.type === "end") {
      if (base.branches.length)
        throw new Error(`结束节点“${base.name}”不能包含分支`);
      if (!["succeeded", "failed"].includes(input.config?.status))
        throw new Error(`节点“${base.name}”的结束状态无效`);
      return {
        ...base,
        type: "end",
        config: {
          status: input.config.status,
          summary: text(input.config?.summary, "结束摘要", 1000, true),
        },
      };
    }
    throw new Error("不支持的工作流节点类型");
  }
  private variableCondition(value: string) {
    return value.match(
      /^(?:变量|variable)[.：:\s]+([\w.\-\u4e00-\u9fff]+)\s*(大于等于|小于等于|不等于|不包含|等于|包含|非空|为空|>=|<=|!=|==|>|<)\s*[:：]?\s*(.*)$/i,
    );
  }
  private validateBranchCondition(
    value: string,
    nodeName: string,
    branchName: string,
  ) {
    const condition = value.trim().toLowerCase();
    if (
      [
        "成功",
        "执行成功",
        "success",
        "succeeded",
        "失败",
        "执行失败",
        "failure",
        "failed",
        "始终",
        "总是",
        "always",
      ].includes(condition)
    )
      return;
    if (
      /^(摘要|summary)\s*(包含|contains)\s*[:：]?\s*.+$/i.test(value) ||
      /^(错误|error)\s*(包含|contains)\s*[:：]?\s*.+$/i.test(value) ||
      this.variableCondition(value)
    )
      return;
    throw new Error(
      `节点“${nodeName}”分支“${branchName}”的判断条件无效；支持执行状态、摘要/错误包含及变量比较`,
    );
  }
  private branchMatches(
    branch: WorkflowBranch,
    success: boolean,
    nodeRun?: WorkflowNodeRun,
    run?: WorkflowRun,
  ) {
    const value = branch.condition.trim(),
      condition = value.toLowerCase();
    if (["成功", "执行成功", "success", "succeeded"].includes(condition))
      return success;
    if (["失败", "执行失败", "failure", "failed"].includes(condition))
      return !success;
    if (["始终", "总是", "always"].includes(condition)) return true;
    const content = value.match(
      /^(摘要|summary|错误|error)\s*(包含|contains)\s*[:：]?\s*(.+)$/i,
    );
    if (content) {
      const source = /^(摘要|summary)$/i.test(content[1])
        ? nodeRun?.summary
        : nodeRun?.error;
      return !!source?.includes(content[3].trim());
    }
    const variable = this.variableCondition(value);
    if (!variable) return false;
    const actual = run?.variables?.[variable[1]] || "",
      operator = variable[2],
      expected = variable[3].trim();
    if (["为空"].includes(operator)) return !actual;
    if (["非空"].includes(operator)) return !!actual;
    if (["等于", "=="].includes(operator)) return actual === expected;
    if (["不等于", "!="].includes(operator)) return actual !== expected;
    if (operator === "包含") return actual.includes(expected);
    if (operator === "不包含") return !actual.includes(expected);
    const left = Number(actual),
      right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (["大于等于", ">="].includes(operator)) return left >= right;
    if (["小于等于", "<="].includes(operator)) return left <= right;
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    return false;
  }
  private validate(
    input: WorkflowDefinitionInput,
    previous?: WorkflowDefinition,
  ): WorkflowDefinition {
    if (
      !this.agent.projects().some((project) => project.id === input.projectId)
    )
      throw new Error("请选择有效项目");
    if (
      !Array.isArray(input.nodes) ||
      !input.nodes.length ||
      input.nodes.length > 100
    )
      throw new Error("工作流需要 1–100 个节点");
    const ids = new Set(
      input.nodes.map((node) => text(node.id, "节点 ID", 80)),
    );
    if (ids.size !== input.nodes.length) throw new Error("节点 ID 不能重复");
    const nodes = input.nodes.map((node) =>
        this.node(structuredClone(node), ids),
      ),
      rawEntryNodeIds =
        Array.isArray(input.entryNodeIds) && input.entryNodeIds.length
          ? input.entryNodeIds
          : [input.entryNodeId],
      entryNodeIds = [
        ...new Set(rawEntryNodeIds.map((id) => text(id, "入口节点", 80))),
      ];
    if (entryNodeIds.some((id) => !ids.has(id)))
      throw new Error("入口节点不存在");
    const entryNodeId = entryNodeIds[0];
    const map = new Map(nodes.map((node) => [node.id, node])),
      visiting = new Set<string>(),
      visited = new Set<string>();
    const targets = (node: WorkflowNode) =>
      node.branches?.flatMap((branch) => branch.targetNodeIds || []) || [];
    const walk = (id: string) => {
      if (visiting.has(id))
        throw new Error("首版工作流不允许循环，请移除节点回路");
      if (visited.has(id)) return;
      visiting.add(id);
      const node = map.get(id)!;
      for (const next of targets(node)) walk(next);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of entryNodeIds) walk(id);
    if (visited.size !== nodes.length)
      throw new Error("工作流包含从入口无法到达的节点");
    const reaches = (
      from: string,
      target: string,
      seen = new Set<string>(),
    ): boolean => {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      const node = map.get(from);
      return (
        !!node && targets(node).some((next) => reaches(next, target, seen))
      );
    };
    for (const node of nodes)
      if (["condition", "route"].includes(node.type)) {
        const sourceNodeId =
          node.type === "condition" || node.type === "route"
            ? node.config.sourceNodeId
            : "";
        if (sourceNodeId === node.id || !reaches(sourceNodeId, node.id))
          throw new Error(
            `${node.type === "route" ? "路由" : "条件"}节点“${node.name}”只能引用此前执行的节点`,
          );
      }
    const layout =
      input.layout?.nodes && typeof input.layout.nodes === "object"
        ? {
            nodes: Object.fromEntries(
              nodes.flatMap((node) => {
                const point = input.layout!.nodes[node.id];
                return point &&
                  Number.isFinite(point.x) &&
                  Number.isFinite(point.y)
                  ? [
                      [
                        node.id,
                        {
                          x: Math.max(0, Math.min(10000, Math.round(point.x))),
                          y: Math.max(0, Math.min(10000, Math.round(point.y))),
                        },
                      ],
                    ]
                  : [];
              }),
            ),
            ...(input.layout.start &&
            Number.isFinite(input.layout.start.x) &&
            Number.isFinite(input.layout.start.y)
              ? {
                  start: {
                    x: Math.max(
                      0,
                      Math.min(10000, Math.round(input.layout.start.x)),
                    ),
                    y: Math.max(
                      0,
                      Math.min(10000, Math.round(input.layout.start.y)),
                    ),
                  },
                }
              : {}),
          }
        : undefined;
    const timestamp = now();
    return {
      id: previous?.id || randomUUID(),
      name: text(input.name, "工作流名称", 100),
      description: text(input.description, "工作流说明", 1000, true),
      projectId: input.projectId,
      enabled: input.enabled !== false,
      version: (previous?.version || 0) + 1,
      entryNodeId,
      entryNodeIds,
      nodes,
      ...(layout ? { layout } : {}),
      timeoutMinutes: integer(input.timeoutMinutes, "工作流超时", 1, 1440),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }
  save(input: WorkflowDefinitionInput) {
    const rows = this.definitions(),
      previous = input.id ? rows.find((row) => row.id === input.id) : undefined;
    if (input.id && !previous) throw new Error("工作流不存在");
    const definition = this.validate(input, previous),
      next = previous
        ? rows.map((row) => (row.id === definition.id ? definition : row))
        : [definition, ...rows];
    this.writeDefinitions(next);
    const versions = readIntegrationJson<WorkflowDefinition[]>(
      this.versionsFile,
      [],
    );
    writeIntegrationJson(
      this.versionsFile,
      [
        ...versions.filter(
          (item) =>
            item.id !== definition.id || item.version !== definition.version,
        ),
        definition,
      ].slice(-500),
    );
    return definition;
  }
  delete(id: string) {
    const rows = this.definitions();
    if (!rows.some((row) => row.id === id)) throw new Error("工作流不存在");
    if (
      this.runs(id, 2000).some((run) =>
        ["running", "waiting"].includes(run.status),
      )
    )
      throw new Error("工作流正在运行，不能删除");
    this.writeDefinitions(rows.filter((row) => row.id !== id));
    this.writeRuns(
      this.runs(undefined, 2000).filter((run) => run.workflowId !== id),
    );
    const versions = readIntegrationJson<WorkflowDefinition[]>(
      this.versionsFile,
      [],
    );
    writeIntegrationJson(
      this.versionsFile,
      versions.filter((item) => item.id !== id),
    );
  }
  action(id: string, action: "run" | "enable" | "pause") {
    const rows = this.definitions(),
      definition = rows.find((row) => row.id === id);
    if (!definition) throw new Error("工作流不存在");
    if (action === "run") return this.start(id);
    definition.enabled = action === "enable";
    definition.updatedAt = now();
    this.writeDefinitions(rows);
    return definition;
  }
  start(
    id: string,
    onUpdate?: (run: WorkflowRun) => void,
    startNodeId?: string,
    resumedFromRunId?: string,
  ) {
    const definition = this.definitions().find((row) => row.id === id);
    if (!definition) throw new Error("工作流不存在");
    const entries = startNodeId
      ? [startNodeId]
      : definition.entryNodeIds?.length
        ? definition.entryNodeIds
        : [definition.entryNodeId];
    if (
      entries.some(
        (entry) => !definition.nodes.some((node) => node.id === entry),
      )
    )
      throw new Error("重试节点不存在");
    const entry = entries[0],
      run: WorkflowRun = {
        id: randomUUID(),
        workflowId: definition.id,
        workflowName: definition.name,
        workflowVersion: definition.version,
        projectId: definition.projectId,
        status: "running",
        currentNodeId: entry,
        pendingNodeIds: entries.slice(1),
        nodeInputSignals: {},
        variables: {},
        nodeRuns: [],
        agentTaskIds: [],
        startedAt: now(),
        ...(resumedFromRunId ? { resumedFromRunId } : {}),
      };
    this.writeRuns([...this.runs(undefined, 2000), run]);
    if (onUpdate) this.callbacks.set(run.id, onUpdate);
    const timeout = setTimeout(
      () =>
        this.fail(
          run.id,
          "工作流超过 " + definition.timeoutMinutes + " 分钟，已停止",
        ),
      definition.timeoutMinutes * 60_000,
    );
    timeout.unref?.();
    this.timeouts.set(run.id, timeout);
    this.emit(run);
    void this.execute(definition, run.id, entry);
    return run;
  }
  retry(runId: string, nodeId: string, onUpdate?: (run: WorkflowRun) => void) {
    const previous = this.runs(undefined, 2000).find((run) => run.id === runId);
    if (!previous) throw new Error("工作流运行不存在");
    if (!["failed", "cancelled"].includes(previous.status))
      throw new Error("只能从失败或取消的运行重试");
    if (
      !previous.nodeRuns.some(
        (node) => node.nodeId === nodeId && node.status === "failed",
      )
    )
      throw new Error("只能从失败节点重试");
    return this.start(previous.workflowId, onUpdate, nodeId, previous.id);
  }
  cancel(runId: string) {
    const run = this.runs(undefined, 2000).find((row) => row.id === runId);
    if (!run) throw new Error("工作流运行不存在");
    if (!["running", "waiting"].includes(run.status)) return run;
    run.status = "cancelled";
    run.finishedAt = now();
    run.error = "用户取消了工作流";
    const node = [...run.nodeRuns]
      .reverse()
      .find((item) => item.status === "running" || item.status === "waiting");
    if (node) {
      node.status = "failed";
      node.error = "用户取消了此节点";
      node.finishedAt = now();
    }
    const agentId = this.activeAgents.get(run.id);
    if (agentId)
      try {
        this.agent.stop(agentId, 0);
      } catch {}
    this.finish(run);
    return run;
  }
  resolveApproval(runId: string, decision: "approved" | "rejected") {
    const run = this.runs(undefined, 2000).find((row) => row.id === runId);
    if (!run) throw new Error("工作流运行不存在");
    if (run.status !== "waiting" || !run.currentNodeId)
      throw new Error("工作流当前未等待人工确认");
    const definition = this.definitions().find(
      (row) => row.id === run.workflowId,
    );
    if (!definition) throw new Error("工作流不存在");
    const node = definition.nodes.find((item) => item.id === run.currentNodeId);
    if (!node || node.type !== "approval")
      throw new Error("当前节点不是人工确认节点");
    const nodeRun = [...run.nodeRuns]
      .reverse()
      .find((item) => item.nodeId === node.id && item.status === "waiting");
    if (!nodeRun) throw new Error("找不到待确认节点");
    run.status = "running";
    nodeRun.status = "succeeded";
    nodeRun.outputValue = decision;
    nodeRun.summary =
      decision === "approved"
        ? node.config.approveLabel
        : node.config.rejectLabel;
    nodeRun.finishedAt = now();
    this.persist(run);
    void this.advance(definition, run, node, decision === "approved");
    return run;
  }
  private trace(
    run: WorkflowRun,
    level: "info" | "warn" | "error",
    message: string,
    nodeId?: string,
  ) {
    run.logs = run.logs || [];
    run.logs.push({ at: now(), level, message, ...(nodeId ? { nodeId } : {}) });
    if (run.logs.length > 300) run.logs.splice(0, run.logs.length - 300);
    this.log?.(level, `工作流“${run.workflowName}”${message}`);
  }
  private inputPath(
    inputs: Record<string, unknown>,
    path: string,
  ): string | undefined {
    let value: unknown = inputs;
    for (const part of path.split(".")) {
      if (!part) return undefined;
      if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
      else if (value && typeof value === "object")
        value = (value as Record<string, unknown>)[part];
      else return undefined;
    }
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  private canReadNodeOutput(
    sourceId: string,
    scope?: { definition: WorkflowDefinition; node: WorkflowNode },
    run?: WorkflowRun,
  ) {
    if (!scope || !run) return true;
    return (run.nodeInputSignals?.[scope.node.id] || []).includes(sourceId);
  }
  private render(
    value: string,
    run: WorkflowRun,
    scope?: { definition: WorkflowDefinition; node: WorkflowNode },
  ) {
    return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key: string) => {
      const name = key.trim();
      const inputPath = name.match(/^inputs?\.(.+)$/);
      if (inputPath && scope)
        return (
          this.inputPath(
            this.upstreamInputs(scope.definition, scope.node, run),
            inputPath[1],
          ) ?? _match
        );
      if (name.startsWith("variables."))
        return run.variables?.[name.slice(10)] ?? _match;
      if (run.variables && name in run.variables) return run.variables[name];
      const outputPath = name.match(/^([^.]+)\.output(?:\.(.+))?$/);
      if (outputPath) {
        if (!this.canReadNodeOutput(outputPath[1], scope, run)) return _match;
        const node = run.nodeRuns.find((item) => item.nodeId === outputPath[1]);
        if (!node) return _match;
        if (!outputPath[2]) return node.outputValue ?? "";
        try {
          let value: unknown = JSON.parse(node.outputValue || "null");
          for (const part of outputPath[2].split(".")) {
            if (!part) return _match;
            if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
            else if (value && typeof value === "object")
              value = (value as Record<string, unknown>)[part];
            else return _match;
          }
          if (value === undefined || value === null) return "";
          return typeof value === "object" ? JSON.stringify(value) : String(value);
        } catch {
          return _match;
        }
      }
      const split = name.lastIndexOf(".");
      if (split > 0) {
        if (!this.canReadNodeOutput(name.slice(0, split), scope, run))
          return _match;
        const node = run.nodeRuns.find(
            (item) => item.nodeId === name.slice(0, split),
          ),
          field = name.slice(split + 1);
        if (node && ["summary", "output", "status", "error"].includes(field))
          return String(
            field === "output"
              ? (node.outputValue ?? "")
              : (node[field as "summary" | "status" | "error"] ?? ""),
          );
      }
      return _match;
    });
  }
  private outputTemplate(
    value: unknown,
    label: string,
  ): Record<string, unknown> {
    const source = text(value, label, 4000);
    let template: unknown;
    try {
      template = JSON.parse(source);
    } catch {
      throw new Error(`${label}必须是有效 JSON 对象`);
    }
    if (!template || typeof template !== "object" || Array.isArray(template))
      throw new Error(`${label}必须是 JSON 对象`);
    let leaves = 0;
    const inspect = (item: unknown, path: string): void => {
      if (typeof item === "string") {
        if (item !== "")
          throw new Error(`${label}的属性“${path}”必须留空字符串`);
        leaves++;
        return;
      }
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error(`${label}的属性“${path}”只能是对象或留空字符串`);
      const entries = Object.entries(item as Record<string, unknown>);
      if (!entries.length) throw new Error(`${label}的对象“${path}”不能为空`);
      for (const [key, child] of entries)
        inspect(child, path ? `${path}.${key}` : key);
    };
    inspect(template, "");
    if (!leaves) throw new Error(`${label}至少需要一个留空字符串属性`);
    return template as Record<string, unknown>;
  }
  private outputMatchesTemplate(template: unknown, output: unknown): boolean {
    if (typeof template === "string")
      return template === "" && typeof output === "string";
    if (
      !template ||
      typeof template !== "object" ||
      Array.isArray(template) ||
      !output ||
      typeof output !== "object" ||
      Array.isArray(output)
    )
      return false;
    const expected = Object.entries(template as Record<string, unknown>),
      actual = output as Record<string, unknown>;
    return (
      expected.length === Object.keys(actual).length &&
      expected.every(
        ([key, value]) =>
          key in actual && this.outputMatchesTemplate(value, actual[key]),
      )
    );
  }
  private compactJson(value: unknown, max = 3000) {
    const source = JSON.stringify(value, null, 2);
    return source.length > max
      ? source.slice(0, max) + "\n...（内容过长，已截断）"
      : source;
  }
  private objectOutput(value?: string): Record<string, unknown> | undefined {
    if (!value) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
    return undefined;
  }
  private mergeInputObject(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ) {
    for (const [key, value] of Object.entries(source)) {
      const current = target[key];
      if (
        current &&
        typeof current === "object" &&
        !Array.isArray(current) &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      )
        this.mergeInputObject(
          current as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      else target[key] = value;
    }
  }
  private upstreamInputs(
    definition: WorkflowDefinition,
    node: WorkflowNode,
    run: WorkflowRun,
  ) {
    const inputs: Record<string, unknown> = {};
    for (const sourceId of run.nodeInputSignals?.[node.id] || []) {
      const source = definition.nodes.find((item) => item.id === sourceId),
        sourceInput: Record<string, unknown> = {};
      if (source?.type === "data")
        for (const assignment of source.config.assignments) {
          const name = assignment.name.trim();
          if (name && run.variables && name in run.variables)
            sourceInput[name] = run.variables[name];
        }
      const sourceRun = [...run.nodeRuns]
        .reverse()
        .find(
          (item) =>
            item.nodeId === sourceId &&
            item.status === "succeeded" &&
            item.outputValue !== undefined,
        );
      if (sourceRun?.outputValue) {
        const output = this.objectOutput(sourceRun.outputValue);
        if (output) this.mergeInputObject(sourceInput, output);
        else sourceInput.output = sourceRun.outputValue;
      }
      inputs[sourceId] = sourceInput;
    }
    return inputs;
  }
  private agentPrompt(
    definition: WorkflowDefinition,
    node: Extract<WorkflowNode, { type: "agent" }>,
    run: WorkflowRun,
  ) {
    const inputs = this.upstreamInputs(definition, node, run),
      context = {
        variables: run.variables || {},
        previousNodes: run.nodeRuns
          .filter((item) => item.nodeId !== node.id || item.status !== "running")
          .map((item) => ({
            id: item.nodeId,
            name: item.nodeName,
            type: item.type,
            status: item.status,
            summary: item.summary,
            error: item.error,
            branchId: item.branchId,
            branchName: item.branchName,
            output: item.outputValue,
            outputJson: this.objectOutput(item.outputValue),
          })),
      },
      expanded = this.render(node.config.instruction, run, { definition, node });
    if (node.config.branchMode !== "ai")
      return `${expanded}\n\n输入 JSON：\n${this.compactJson(inputs)}\n\n工作流上下文：\n${this.compactJson(context)}`;
    const branches = (node.branches || []).map((branch, index) => ({
        order: index + 1,
        id: branch.id,
        name: branch.name,
        judgement: branch.condition,
        outputFormat: this.outputTemplate(
          branch.outputValue,
          `Agent“${node.name}”分支“${branch.name}”的输出 JSON`,
        ),
      })),
      protocol = `你正在执行工作流 Agent 节点“${node.name}”。必须严格遵守以下协议：
1. 先完成“任务要求”，再只根据“输出分支”的 judgement 判断方式选择分支。
2. 按输出分支 order 从小到大评估；选择第一条判断方式成立的分支。不得改写、放宽、忽略判断方式，不得编造未配置分支。
3. 如果没有任何判断方式成立，且没有 judgement 明确表示“始终 / 总是 / always / 默认 / 兜底”的分支，返回 {"branchId":"__NO_MATCH__","output":{}}。
4. 最终回答只能是一个 JSON 对象，不能包含 Markdown、解释、代码块或额外文字。
5. JSON 对象只能包含 branchId 和 output 两个属性。branchId 必须是所选分支 id；output 必须严格匹配该分支 outputFormat：属性名、层级、属性数量完全一致，所有叶子值都必须是字符串。`;
    if (protocol.length > 6000)
      throw new Error(`Agent“${node.name}”的分支配置过长`);
    const fixed = `${protocol}\n\n输入 JSON：\n${this.compactJson(inputs)}\n\n工作流上下文：\n${this.compactJson(context)}\n\n输出分支：\n${this.compactJson(branches, 7000)}\n\n任务要求：\n`,
      room = 15800 - fixed.length;
    if (room < 1000)
      throw new Error(`Agent“${node.name}”的分支配置过长，请减少分支或输出字段`);
    return (
      fixed +
      (expanded.length > room
        ? expanded.slice(0, room) + "\n...（任务要求过长，已截断）"
        : expanded)
    );
  }
  private aiDecision(
    source: string,
    node: Extract<WorkflowNode, { type: "agent" }>,
  ) {
    let response: unknown;
    try {
      response = JSON.parse(
        source
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim(),
      );
    } catch {
      throw new Error(
        'AI 返回的结果不是有效 JSON；应只返回 {"branchId":"分支 ID","output":{...}}',
      );
    }
    if (!response || typeof response !== "object" || Array.isArray(response))
      throw new Error("AI 返回的结果必须是 JSON 对象");
    const value = response as Record<string, unknown>,
      keys = Object.keys(value).sort();
    if (keys.join(",") !== "branchId,output")
      throw new Error("AI 返回 JSON 只能包含 branchId 和 output 两个属性");
    if (value.branchId === "__NO_MATCH__")
      throw new Error("AI 严格判断后没有命中任何输出分支");
    if (typeof value.branchId !== "string")
      throw new Error("AI 返回的 branchId 必须是字符串");
    const branch = node.branches?.find((item) => item.id === value.branchId);
    if (!branch) throw new Error("AI 返回了不存在的输出分支");
    if (!value.output || typeof value.output !== "object" || Array.isArray(value.output))
      throw new Error("AI 返回的 output 必须是 JSON 对象");
    const template = this.outputTemplate(
      branch.outputValue,
      `Agent“${node.name}”分支“${branch.name}”的输出 JSON`,
    );
    if (!this.outputMatchesTemplate(template, value.output))
      throw new Error(`AI 返回的输出不符合分支“${branch.name}”的 JSON 格式`);
    return { branch, output: value.output as Record<string, unknown> };
  }
  private async execute(
    definition: WorkflowDefinition,
    runId: string,
    nodeId: string,
  ): Promise<void> {
    const run = this.runs(undefined, 2000).find((row) => row.id === runId);
    if (!run || run.status !== "running") return;
    const node = definition.nodes.find((item) => item.id === nodeId);
    if (!node) return this.fail(runId, "工作流节点不存在：" + nodeId);
    run.currentNodeId = node.id;
    const nodeRun: WorkflowNodeRun = {
      nodeId: node.id,
      nodeName: node.name,
      type: node.type,
      status: "running",
      startedAt: now(),
    };
    run.nodeRuns.push(nodeRun);
    this.trace(run, "info", `开始执行节点“${node.name}”`, node.id);
    this.persist(run);
    try {
      if (node.type === "agent") {
        const legacyModel =
            node.config.modelSource === "specified"
              ? node.config.model
              : await this.currentModel?.(),
          wantsLocal =
            node.config.modelRef?.source === "local" ||
            (!node.config.modelRef &&
              node.config.modelSource !== "specified" &&
              this.isLocalModel?.());
        if (wantsLocal && this.activeAgents.size) {
          run.nodeRuns.pop();
          this.pendingLocalAgents.push({ definition, runId, nodeId });
          this.trace(run, "info", `本地模型繁忙，节点“${node.name}”已进入执行队列`, node.id);
          this.persist(run);
          return;
        }
        const prompt = this.agentPrompt(definition, node, run),
          plan = this.prepareModel
            ? await this.prepareModel(node.config.modelRef, legacyModel)
            : { model: legacyModel || node.config.model || "" },
          result = this.agent.start(
            {
              projectId: definition.projectId,
              hidden: true,
              mode: node.config.mode,
              model: (() => {
                const resolved = plan.model || legacyModel || node.config.model;
                if (!resolved)
                  throw new Error(
                    "当前连接尚未选择模型；请在模型连接设置中选择可用模型后重试",
                  );
                return resolved;
              })(),
              ...(plan.connection ? { connectionOverride: plan.connection } : {}),
              prompt,
              maxSteps: node.config.maxSteps,
              fastMode: node.config.fastMode,
              approvalMode: node.config.approvalMode,
            },
            0,
            (task) => this.agentUpdate(definition, run.id, node, task),
          );
        if (plan.label)
          this.trace(
            run,
            "info",
            `节点“${node.name}”使用${plan.source === "local" ? "本地" : plan.source === "remote" ? "远程" : "当前"}模型：${plan.label}`,
            node.id,
          );
        nodeRun.agentTaskId = result.id;
        run.agentTaskIds.push(result.id);
        this.activeAgents.set(run.id, result.id);
        this.persist(run);
        return;
      }
      if (node.type === "condition") {
        const source = run.nodeRuns.find(
            (item) => item.nodeId === node.config.sourceNodeId,
          ),
          matched = source?.status === node.config.operator;
        nodeRun.status = "succeeded";
        nodeRun.summary = matched ? "条件成立" : "条件不成立";
        nodeRun.finishedAt = now();
        this.persist(run);
        return this.advance(definition, run, node, matched);
      }
      if (node.type === "route") {
        const source = run.nodeRuns.find(
            (item) => item.nodeId === node.config.sourceNodeId,
          ),
          success = source?.status === "succeeded",
          branch = node.branches?.find((item) =>
            this.branchMatches(item, success, source, run),
          );
        nodeRun.status = "succeeded";
        nodeRun.summary = branch ? `路由到“${branch.name}”` : "没有匹配的路由";
        nodeRun.finishedAt = now();
        this.persist(run);
        return this.advance(definition, run, node, true, branch || null);
      }
      if (node.type === "data") {
        run.variables = run.variables || {};
        for (const assignment of node.config.assignments)
          run.variables[assignment.name] = this.render(assignment.value, run, {
            definition,
            node,
          });
        nodeRun.status = "succeeded";
        nodeRun.summary = `已设置 ${node.config.assignments.length} 个变量`;
        nodeRun.finishedAt = now();
        this.persist(run);
        return this.advance(definition, run, node, true);
      }
      if (node.type === "join") {
        nodeRun.status = "succeeded";
        nodeRun.summary = `已汇合 ${(run.nodeInputSignals?.[node.id] || []).length} 个输入`;
        nodeRun.finishedAt = now();
        this.persist(run);
        return this.advance(definition, run, node, true);
      }
      if (node.type === "approval") {
        run.status = "waiting";
        nodeRun.status = "waiting";
        nodeRun.summary = this.render(node.config.prompt, run, {
          definition,
          node,
        });
        nodeRun.approval = {
          approveLabel: node.config.approveLabel,
          rejectLabel: node.config.rejectLabel,
        };
        this.persist(run);
        return;
      }
      if (node.type === "end") {
        const summary =
          this.render(node.config.summary, run, { definition, node }) ||
          `${node.config.status === "succeeded" ? "成功" : "失败"}结束`;
        nodeRun.status = "succeeded";
        nodeRun.summary = summary;
        nodeRun.outputValue = summary;
        nodeRun.finishedAt = now();
        run.summary = summary;
        this.persist(run);
        if (node.config.status === "failed") return this.fail(run.id, summary);
        return this.continueRun(definition, run);
      }
      const notified = this.notify?.(
        this.render(node.config.title, run, { definition, node }),
        this.render(node.config.body, run, { definition, node }),
      );
      if (notified === false) throw new Error("当前系统不支持桌面通知");
      nodeRun.status = "succeeded";
      nodeRun.summary = "系统通知已提交";
      nodeRun.finishedAt = now();
      this.persist(run);
      return this.advance(definition, run, node, true);
    } catch (error) {
      nodeRun.status = "failed";
      nodeRun.error = String(error);
      nodeRun.finishedAt = now();
      this.persist(run);
      return this.advance(definition, run, node, false);
    }
  }
  private agentUpdate(
    definition: WorkflowDefinition,
    runId: string,
    node: WorkflowNode,
    task: AgentTask,
  ) {
    if (["running", "waiting"].includes(task.status)) return;
    const run = this.runs(undefined, 2000).find((row) => row.id === runId);
    if (!run || run.status !== "running" || node.type !== "agent") return;
    this.activeAgents.delete(runId);
    this.launchNextLocalAgent();
    const nodeRun = [...run.nodeRuns]
      .reverse()
      .find((item) => item.nodeId === node.id && item.status === "running");
    if (!nodeRun) return;
    const success = task.status === "completed",
      summary = [...task.events]
        .reverse()
        .find(
          (event) =>
            event.kind === "assistant" &&
            event.text &&
            !event.text.startsWith("本次模型未调用工具"),
        )
        ?.text.slice(0, 2000);
    nodeRun.error = task.error || undefined;
    nodeRun.summary = summary;
    if (success && node.config.branchMode === "ai")
      try {
        const decision = this.aiDecision(summary || "", node);
        nodeRun.status = "succeeded";
        nodeRun.branchId = decision.branch.id;
        nodeRun.branchName = decision.branch.name;
        nodeRun.outputValue = JSON.stringify(decision.output);
        nodeRun.summary = nodeRun.outputValue;
        nodeRun.finishedAt = now();
        this.persist(run);
        void this.advance(definition, run, node, true, decision.branch);
        return;
      } catch (error) {
        nodeRun.status = "failed";
        nodeRun.error = String(error);
        nodeRun.finishedAt = now();
        this.persist(run);
        this.fail(run.id, String(error));
        return;
      }
    nodeRun.status = success ? "succeeded" : "failed";
    nodeRun.finishedAt = now();
    this.persist(run);
    void this.advance(definition, run, node, success);
  }
  private launchNextLocalAgent() {
    if (this.activeAgents.size) return;
    while (this.pendingLocalAgents.length) {
      const next = this.pendingLocalAgents.shift()!;
      const run = this.runs(undefined, 2000).find((item) => item.id === next.runId);
      if (!run || run.status !== "running") continue;
      this.trace(run, "info", "本地模型已空闲，开始执行排队节点", next.nodeId);
      this.persist(run);
      void this.execute(next.definition, next.runId, next.nodeId);
      return;
    }
  }
  private incomingSources(definition: WorkflowDefinition, nodeId: string) {
    return [
      ...new Set(
        definition.nodes
          .filter((source) =>
            source.branches?.some((branch) =>
              branch.targetNodeIds?.includes(nodeId),
            ),
          )
          .map((source) => source.id),
      ),
    ];
  }
  private inputReady(
    definition: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
  ) {
    const mode =
      node.type === "join"
        ? node.config.mode
        : node.type === "agent"
          ? node.config.inputSignalMode || "all"
          : "any";
    if (mode === "any") return true;
    const expected = this.incomingSources(definition, node.id);
    if (expected.length < 2) return true;
    const received = new Set(run.nodeInputSignals?.[node.id] || []);
    return expected.every((source) => received.has(source));
  }
  private continueRun(definition: WorkflowDefinition, run: WorkflowRun) {
    while (run.pendingNodeIds?.length) {
      const next = run.pendingNodeIds.shift()!;
      if (run.nodeRuns.some((item) => item.nodeId === next)) continue;
      this.persist(run);
      return this.execute(definition, run.id, next);
    }
    const waiting = definition.nodes.find(
      (node) =>
        (node.type === "agent" || node.type === "join") &&
        !run.nodeRuns.some((item) => item.nodeId === node.id) &&
        (run.nodeInputSignals?.[node.id]?.length || 0) > 0 &&
        !this.inputReady(definition, run, node),
    );
    if (waiting) {
      const received = new Set(run.nodeInputSignals?.[waiting.id] || []),
        missing = this.incomingSources(definition, waiting.id)
          .filter((source) => !received.has(source))
          .map(
            (id) => definition.nodes.find((node) => node.id === id)?.name || id,
          );
      return this.fail(
        run.id,
        `${waiting.type === "join" ? "汇合" : "Agent"}“${waiting.name}”正在等待全部输入，缺少：${missing.join("、")}`,
      );
    }
    run.status = "succeeded";
    run.finishedAt = now();
    run.currentNodeId = undefined;
    run.summary =
      [...run.nodeRuns]
        .reverse()
        .find((item) => item.outputValue || item.summary)?.outputValue ||
      [...run.nodeRuns].reverse().find((item) => item.summary)?.summary ||
      "工作流执行完成";
    this.finish(run);
  }
  private async advance(
    definition: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    success: boolean,
    selectedBranch?: WorkflowBranch | null,
  ) {
    if (run.status !== "running") return;
    const nodeRun = run.nodeRuns.at(-1),
      branch =
        selectedBranch === null
          ? undefined
          : selectedBranch ||
            node.branches?.find((item) =>
              this.branchMatches(item, success, nodeRun, run),
            );
    if (branch && nodeRun) {
      nodeRun.branchId = branch.id;
      nodeRun.branchName = branch.name;
      if (
        branch.outputValue &&
        !(node.type === "agent" && node.config.branchMode === "ai")
      ) {
        nodeRun.outputValue = this.render(branch.outputValue, run, {
          definition,
          node,
        });
        nodeRun.summary = nodeRun.outputValue;
      }
      const queued = new Set([
        ...(run.pendingNodeIds || []),
        ...run.nodeRuns.map((item) => item.nodeId),
      ]);
      run.pendingNodeIds = run.pendingNodeIds || [];
      run.nodeInputSignals = run.nodeInputSignals || {};
      for (const targetId of branch.targetNodeIds || []) {
        const signals = run.nodeInputSignals[targetId] || [];
        if (!signals.includes(node.id)) signals.push(node.id);
        run.nodeInputSignals[targetId] = signals;
        const target = definition.nodes.find((item) => item.id === targetId);
        if (
          target &&
          this.inputReady(definition, run, target) &&
          !queued.has(targetId)
        ) {
          run.pendingNodeIds.push(targetId);
          queued.add(targetId);
        }
      }
      this.persist(run);
    }
    if (node.branches?.length && !branch)
      return this.fail(run.id, `节点“${node.name}”没有命中任何分支`);
    if (!success && !branch)
      return this.fail(run.id, nodeRun?.error || `节点“${node.name}”执行失败`);
    return this.continueRun(definition, run);
  }
  private fail(runId: string, error: string) {
    const run = this.runs(undefined, 2000).find((row) => row.id === runId);
    if (!run || !["running", "waiting"].includes(run.status)) return;
    run.status = "failed";
    run.error = error;
    run.finishedAt = now();
    const node = [...run.nodeRuns]
      .reverse()
      .find((item) => item.status === "running");
    if (node) {
      node.status = "failed";
      node.error = error;
      node.finishedAt = now();
    }
    const agentId = this.activeAgents.get(run.id);
    if (agentId)
      try {
        this.agent.stop(agentId, 0);
      } catch {}
    this.finish(run);
  }
  private persist(run: WorkflowRun) {
    const rows = this.runs(undefined, 2000);
    const index = rows.findIndex((row) => row.id === run.id);
    if (index >= 0) rows[index] = run;
    else rows.push(run);
    this.writeRuns(rows);
    this.emit(run);
  }
  private finish(run: WorkflowRun) {
    const timeout = this.timeouts.get(run.id);
    if (timeout) clearTimeout(timeout);
    this.timeouts.delete(run.id);
    this.activeAgents.delete(run.id);
    const level =
        run.status === "succeeded"
          ? "info"
          : run.status === "cancelled"
            ? "warn"
            : "error",
      message =
        run.status === "succeeded"
          ? "执行成功"
          : run.status === "cancelled"
            ? "已取消"
            : `执行失败${run.error ? "；" + run.error : ""}`;
    this.trace(run, level, message);
    this.persist(run);
    this.callbacks.delete(run.id);
  }
  private emit(run: WorkflowRun) {
    this.callbacks.get(run.id)?.(structuredClone(run));
  }
  private recover() {
    const rows = this.runs(undefined, 2000);
    let changed = false;
    for (const run of rows)
      if (["running", "waiting"].includes(run.status)) {
        run.status = "failed";
        run.error = "应用在执行期间关闭，结果未确认；不会自动重放。";
        run.finishedAt = now();
        changed = true;
      }
    if (changed) this.writeRuns(rows);
  }
  dispose() {
    for (const run of this.runs(undefined, 2000).filter((row) =>
      ["running", "waiting"].includes(row.status),
    ))
      this.cancel(run.id);
    for (const timeout of this.timeouts.values()) clearTimeout(timeout);
    this.timeouts.clear();
    this.callbacks.clear();
  }
}
