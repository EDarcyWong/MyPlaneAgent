<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Bell,
  Check,
  Close,
  Connection,
  Cpu,
  DataAnalysis,
  Delete,
  Edit,
  Flag,
  Guide,
  Plus,
  Position,
  Rank,
  RefreshLeft,
  RefreshRight,
  ScaleToOriginal,
  UserFilled,
  VideoPause,
  VideoPlay,
  ZoomIn,
  ZoomOut,
} from "@element-plus/icons-vue";
import type { AgentProject } from "../../electron/shared/local-ai-agent";
import type {
  WorkflowBranch,
  WorkflowDefinition,
  WorkflowDefinitionInput,
  WorkflowInputParameter,
  WorkflowNode,
  WorkflowRun,
  WorkflowVariableAssignment,
} from "../../electron/shared/local-ai-workflow";

type ModelOption = { id: string; name?: string; instanceId?: string };
const props = withDefaults(
    defineProps<{
      model: string;
      models: ModelOption[];
      windowMode?: boolean;
      workflowId?: string;
    }>(),
    { windowMode: false, workflowId: "" },
  ),
  api = window.myplane.localAiStudio;
const definitions = ref<WorkflowDefinition[]>([]),
  runs = ref<WorkflowRun[]>([]),
  projects = ref<AgentProject[]>([]),
  editing = ref(false),
  selectedId = ref(""),
  historyId = ref(""),
  busy = ref(""),
  error = ref(""),
  selectedNodeId = ref("__start__");
const canvas = ref<HTMLElement>(),
  canvasHost = ref<HTMLElement>();
let timer: ReturnType<typeof setInterval> | undefined,
  historyTimer: ReturnType<typeof setTimeout> | undefined,
  disposeSaved: (() => void) | undefined,
  nodeSequence = 0,
  applyingHistory = false;
type FormBranch = WorkflowBranch;
type FormNode = {
  id: string;
  name: string;
  type: WorkflowNode["type"];
  branches: FormBranch[];
  instruction: string;
  model: string;
  modelSource: "current" | "specified";
  mode: "coding" | "general" | "documents";
  maxSteps: number;
  fastMode: boolean;
  approvalMode: "ask" | "auto" | "full" | "unrestricted";
  inputs: WorkflowInputParameter[];
  inputSignalMode: "all" | "any";
  branchMode: "ai" | "rules";
  sourceNodeId: string;
  operator: "succeeded" | "failed";
  assignments: WorkflowVariableAssignment[];
  joinMode: "all" | "any";
  approvalPrompt: string;
  approveLabel: string;
  rejectLabel: string;
  title: string;
  body: string;
  endStatus: "succeeded" | "failed";
  endSummary: string;
  x: number;
  y: number;
};
type Branch = string;
type ConnectionDraft = {
  sourceId: string;
  branch: Branch;
  mode: "add" | "replace";
  originalTargetId?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
type DragState = {
  clientX: number;
  clientY: number;
  positions: Map<string, { x: number; y: number }>;
};
type PanState = { clientX: number; clientY: number; x: number; y: number };
type CanvasEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  branch: Branch;
  from: { x: number; y: number };
  to: { x: number; y: number };
  label: string;
  color: string;
};
type SelectionMode = "replace" | "add" | "toggle" | "subtract";
type SelectionBox = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mode: SelectionMode;
  initial: Set<string>;
};
const connection = ref<ConnectionDraft>(),
  drag = ref<DragState>(),
  pan = ref<PanState>(),
  selectionBox = ref<SelectionBox>(),
  viewport = reactive({ x: 0, y: 0 }),
  zoom = ref(1),
  edgeMenu = ref<{ edge: CanvasEdge; x: number; y: number }>(),
  selectedEdgeKey = ref<{
    sourceId: string;
    branch: Branch;
    targetId: string;
  }>(),
  selectedNodeIds = ref(new Set<string>(["__start__"]));
let spacePressed = false,
  suppressEdgeMenuUntil = 0;
const newNode = (type: FormNode["type"] = "agent", index = 0): FormNode => {
  nodeSequence++;
  const names: Record<FormNode["type"], string> = {
      agent: "Agent 任务",
      condition: "旧版判断",
      route: "条件路由",
      data: "设置数据",
      join: "汇合",
      approval: "人工确认",
      notify: "系统通知",
      end: "结束",
    },
    branches: FormBranch[] =
      type === "agent"
        ? [
            {
              id: `result_${nodeSequence}`,
              name: "默认结果",
              condition: "任务完成且结果符合预期时选择此分支",
              color: "#347fc5",
              targetNodeIds: [],
              outputValue: '{"result":""}',
            },
          ]
        : type === "approval"
          ? [
              {
                id: `approved_${nodeSequence}`,
                name: "批准",
                condition: "执行成功",
                color: "#2f9b74",
                targetNodeIds: [],
              },
              {
                id: `rejected_${nodeSequence}`,
                name: "拒绝",
                condition: "执行失败",
                color: "#d45b68",
                targetNodeIds: [],
              },
            ]
          : [];
  return {
    id: `step_${Date.now().toString(36)}_${nodeSequence}`,
    name: names[type],
    type,
    branches,
    instruction: "",
    model: props.model || props.models[0]?.id || "",
    modelSource: "current",
    mode: "coding",
    maxSteps: 30,
    fastMode: true,
    approvalMode: "ask",
    inputs: [],
    inputSignalMode: "any",
    branchMode: "ai",
    sourceNodeId: "",
    operator: "succeeded",
    assignments: type === "data" ? [{ name: "result", value: "" }] : [],
    joinMode: "all",
    approvalPrompt: "请确认是否继续执行工作流",
    approveLabel: "批准",
    rejectLabel: "拒绝",
    title: "工作流通知",
    body: "工作流节点执行完成",
    endStatus: "succeeded",
    endSummary: "工作流执行完成",
    x: 320 + (index % 3) * 290,
    y: 110 + Math.floor(index / 3) * 190,
  };
};
const fresh = () => ({
  id: "",
  name: "新建工作流",
  description: "",
  projectId: "",
  enabled: true,
  timeoutMinutes: 120,
  entryNodeIds: [] as string[],
  startX: 60,
  startY: 180,
  nodes: [] as FormNode[],
});
const form = reactive(fresh());
const history = ref<string[]>([]),
  historyIndex = ref(-1),
  canUndo = computed(() => historyIndex.value > 0),
  canRedo = computed(
    () =>
      historyIndex.value >= 0 && historyIndex.value < history.value.length - 1,
  );
const selected = computed(() =>
    definitions.value.find((item) => item.id === selectedId.value),
  ),
  visibleRuns = computed(() =>
    runs.value.filter(
      (item) => !historyId.value || item.workflowId === historyId.value,
    ),
  ),
  running = computed(
    () =>
      runs.value.filter((item) => ["running", "waiting"].includes(item.status))
        .length,
  );
const selectedNode = computed(() =>
    form.nodes.find((node) => node.id === selectedNodeId.value),
  ),
  nodeCandidates = computed(() =>
    form.nodes.filter((node) => node.id !== selectedNode.value?.id),
  ),
  nodeById = computed(() => new Map(form.nodes.map((node) => [node.id, node])));
const viewportTransform = computed(() => ({
    transform: `translate3d(${viewport.x}px,${viewport.y}px,0) scale(${zoom.value})`,
  })),
  gridPosition = computed(() => ({
    backgroundPosition: `${viewport.x}px ${viewport.y}px,${viewport.x}px ${viewport.y}px,${viewport.x}px ${viewport.y}px`,
    backgroundSize: `${100 * zoom.value}px ${100 * zoom.value}px,${100 * zoom.value}px ${100 * zoom.value}px,${20 * zoom.value}px ${20 * zoom.value}px`,
  }));
const selectionStyle = computed(() =>
  selectionBox.value
    ? {
        left: selectionBox.value.x + "px",
        top: selectionBox.value.y + "px",
        width: selectionBox.value.width + "px",
        height: selectionBox.value.height + "px",
      }
    : {},
);
const formSnapshot = () => JSON.stringify(form);
function resetHistory() {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = undefined;
  history.value = [formSnapshot()];
  historyIndex.value = 0;
}
function commitHistory() {
  historyTimer = undefined;
  if (applyingHistory) return;
  const snapshot = formSnapshot();
  if (history.value[historyIndex.value] === snapshot) return;
  history.value = history.value.slice(0, historyIndex.value + 1);
  history.value.push(snapshot);
  if (history.value.length > 100) history.value.shift();
  historyIndex.value = history.value.length - 1;
}
function scheduleHistory() {
  if (applyingHistory || historyIndex.value < 0) return;
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = setTimeout(commitHistory, 220);
}
function flushHistory() {
  if (historyTimer) {
    clearTimeout(historyTimer);
    commitHistory();
  }
}
function restoreHistory(index: number) {
  const snapshot = history.value[index];
  if (!snapshot) return;
  applyingHistory = true;
  Object.assign(form, JSON.parse(snapshot));
  applyingHistory = false;
  historyIndex.value = index;
  selectedEdgeKey.value = undefined;
  setSelection(["__start__"], "__start__");
}
function undo() {
  flushHistory();
  if (canUndo.value) restoreHistory(historyIndex.value - 1);
}
function redo() {
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = undefined;
  }
  if (canRedo.value) restoreHistory(historyIndex.value + 1);
}
const projectName = (id: string) =>
    projects.value.find((item) => item.id === id)?.name || "项目已移除",
  date = (value?: string) =>
    value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
const status = (value: string) =>
  (
    ({
      running: "执行中",
      waiting: "等待中",
      succeeded: "成功",
      failed: "失败",
      cancelled: "已取消",
      skipped: "已跳过",
    }) as Record<string, string>
  )[value] || value;
const nodeType = (type: FormNode["type"]) =>
  (
    ({
      agent: "Agent",
      condition: "旧版判断",
      route: "路由",
      data: "数据",
      join: "汇合",
      approval: "人工确认",
      notify: "系统通知",
      end: "结束",
    }) as Record<FormNode["type"], string>
  )[type];
const nodeHeight = (node: FormNode) =>
  Math.max(140, 92 + node.branches.length * 28);
const nodeSummary = (node: FormNode) =>
  node.type === "agent"
    ? node.instruction.trim().split("\n")[0] || "点击设置 Agent 执行内容"
    : node.type === "condition"
      ? `${nodeById.value.get(node.sourceNodeId)?.name || "未选择来源"} · ${node.operator === "succeeded" ? "执行成功" : "执行失败"}`
      : node.type === "route"
        ? `根据 ${nodeById.value.get(node.sourceNodeId)?.name || "上游结果"} 路由`
        : node.type === "data"
          ? `设置 ${node.assignments.length} 个变量`
          : node.type === "join"
            ? `${node.joinMode === "all" ? "等待全部" : "任一到达"} · ${incomingSourceCount(node.id)} 个上游`
            : node.type === "approval"
              ? node.approvalPrompt
              : node.type === "notify"
                ? node.title || "点击设置通知内容"
                : `${node.endStatus === "succeeded" ? "成功" : "失败"}结束`;
const incomingSourceCount = (nodeId: string) =>
  new Set(
    form.nodes
      .filter((source) =>
        source.branches.some((branch) =>
          branch.targetNodeIds?.includes(nodeId),
        ),
      )
      .map((source) => source.id),
  ).size;
function portPoint(sourceId: string, branch: Branch) {
  if (sourceId === "__start__")
    return { x: form.startX + 150, y: form.startY + 38 };
  const node = nodeById.value.get(sourceId);
  if (!node) return { x: 0, y: 0 };
  const index = Math.max(
    0,
    node.branches.findIndex((item) => item.id === branch),
  );
  return { x: node.x + 230, y: node.y + 68 + index * 28 };
}
function inputPoint(id: string) {
  const node = nodeById.value.get(id);
  return node ? { x: node.x, y: node.y + 70 } : { x: 0, y: 0 };
}
const edges = computed(() => {
  const rows: CanvasEdge[] = [];
  for (const target of form.entryNodeIds)
    if (nodeById.value.has(target))
      rows.push({
        id: "start-" + target,
        sourceId: "__start__",
        targetId: target,
        branch: "start",
        from: portPoint("__start__", "start"),
        to: inputPoint(target),
        label: "开始",
        color: "#2f8a59",
      });
  for (const node of form.nodes)
    for (const branch of node.branches)
      for (const target of branch.targetNodeIds || []) {
        if (nodeById.value.has(target))
          rows.push({
            id: `${node.id}-${branch.id}-${target}`,
            sourceId: node.id,
            targetId: target,
            branch: branch.id,
            from: portPoint(node.id, branch.id),
            to: inputPoint(target),
            label: branch.name,
            color: branch.color,
          });
      }
  return rows;
});
const selectedEdge = computed(() =>
  selectedEdgeKey.value
    ? edges.value.find(
        (edge) =>
          edge.sourceId === selectedEdgeKey.value!.sourceId &&
          edge.branch === selectedEdgeKey.value!.branch &&
          edge.targetId === selectedEdgeKey.value!.targetId,
      )
    : undefined,
);
function outputJsonError(value?: string) {
  if (!value?.trim()) return "请填写输出 JSON 格式";
  try {
    const json = JSON.parse(value);
    let leaves = 0;
    const inspect = (item: unknown): boolean => {
      if (typeof item === "string") {
        leaves++;
        return item === "";
      }
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        !Object.keys(item).length
      )
        return false;
      return Object.values(item as Record<string, unknown>).every(inspect);
    };
    return inspect(json) && leaves ? "" : "JSON 只能包含对象和留空字符串属性";
  } catch {
    return "不是有效的 JSON 对象";
  }
}
const agentBranchOutputErrors = computed(() =>
  form.nodes.flatMap((node) =>
    node.type === "agent" && node.branchMode === "ai"
      ? node.branches
          .map((branch) => ({
            node,
            branch,
            message: outputJsonError(branch.outputValue),
          }))
          .filter((item) => item.message)
      : [],
  ),
);
const invalidInputEdges = computed(
  () =>
    new Set(
      edges.value
        .filter((edge) => {
          const source = nodeById.value.get(edge.sourceId),
            branch = source?.branches.find((item) => item.id === edge.branch);
          return (
            source?.type === "agent" &&
            source.branchMode === "ai" &&
            !!outputJsonError(branch?.outputValue)
          );
        })
        .map((edge) => edge.id),
    ),
);
const inputConnectionErrors = computed(() =>
  agentBranchOutputErrors.value.map(
    (item) => `${item.node.name} / ${item.branch.name}：${item.message}`,
  ),
);
const curve = (
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const bend = Math.max(70, Math.abs(to.x - from.x) * 0.45);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
};
const isSelected = (id: string) => selectedNodeIds.value.has(id);
function setSelection(ids: Iterable<string>, primary?: string) {
  selectedEdgeKey.value = undefined;
  selectedNodeIds.value = new Set(ids);
  selectedNodeId.value =
    primary && selectedNodeIds.value.has(primary)
      ? primary
      : [...selectedNodeIds.value].at(-1) || "";
}
function selectionMode(event: MouseEvent | PointerEvent): SelectionMode {
  return event.altKey
    ? "subtract"
    : event.metaKey || event.ctrlKey
      ? "toggle"
      : event.shiftKey
        ? "add"
        : "replace";
}
function selectNode(id: string, event: PointerEvent) {
  const mode = selectionMode(event),
    next = new Set(selectedNodeIds.value);
  if (mode === "replace") {
    if (!next.has(id) || next.size === 1) setSelection([id], id);
    else selectedNodeId.value = id;
    return;
  }
  if (mode === "add") next.add(id);
  else if (mode === "subtract") next.delete(id);
  else if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelection(next, next.has(id) ? id : undefined);
}
async function load() {
  try {
    const [nextDefinitions, nextRuns, nextProjects] = await Promise.all([
      api("workflowDefinitions"),
      api("workflowRuns", { limit: 200 }),
      api("agentProjects"),
    ]);
    definitions.value = nextDefinitions;
    runs.value = nextRuns;
    projects.value = nextProjects;
  } catch (cause) {
    error.value = String(cause).replace(/^Error: /, "");
  }
}
function addNode(type: FormNode["type"] = "agent") {
  const node = newNode(type, form.nodes.length);
  node.x = (node.x - viewport.x) / zoom.value;
  node.y = (node.y - viewport.y) / zoom.value;
  form.nodes.push(node);
  setSelection([node.id], node.id);
}
function initializeNew() {
  centerCanvas();
  Object.assign(form, fresh(), { projectId: projects.value[0]?.id || "" });
  addNode();
  form.entryNodeIds = form.nodes[0]?.id ? [form.nodes[0].id] : [];
  editing.value = true;
  selectedId.value = "";
  setSelection(["__start__"], "__start__");
  resetHistory();
}
function create() {
  if (!props.windowMode) {
    void window.myplane.openWorkflowEditor();
    return;
  }
  initializeNew();
}
function fromNode(
  node: WorkflowNode,
  index: number,
  definition: WorkflowDefinition,
): FormNode {
  const position = definition.layout?.nodes[node.id] || {
      x: 320 + (index % 3) * 290,
      y: 110 + Math.floor(index / 3) * 190,
    },
    branches = node.branches?.map((branch) => {
      const targetNodeIds = [
        ...(branch.targetNodeIds ||
          (branch.targetNodeId ? [branch.targetNodeId] : [])),
      ];
      return {
        ...branch,
        targetNodeIds,
        ...(targetNodeIds.length
          ? { targetNodeId: targetNodeIds.join("\u001f") }
          : {}),
      };
    }) || [
      ...(node.onSuccess
        ? [
            {
              id: "success",
              name: "成功",
              condition: "执行成功",
              color: "#4a9a6e",
              targetNodeIds: [node.onSuccess],
              targetNodeId: node.onSuccess,
            },
          ]
        : []),
      ...(node.onFailure
        ? [
            {
              id: "failure",
              name: "失败",
              condition: "执行失败",
              color: "#c65a52",
              targetNodeIds: [node.onFailure],
              targetNodeId: node.onFailure,
            },
          ]
        : []),
    ],
    inputs =
      node.type === "agent"
        ? (node.config.inputs || []).map((parameter) => ({
            name: parameter.name,
            description: parameter.description || "",
          }))
        : [];
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    branches,
    instruction: node.type === "agent" ? node.config.instruction : "",
    model: node.type === "agent" ? node.config.model || "" : props.model || "",
    modelSource:
      node.type === "agent" ? node.config.modelSource || "current" : "current",
    mode: node.type === "agent" ? node.config.mode : "coding",
    maxSteps: node.type === "agent" ? node.config.maxSteps : 30,
    fastMode: node.type === "agent" ? node.config.fastMode : true,
    approvalMode: node.type === "agent" ? node.config.approvalMode : "ask",
    inputs,
    inputSignalMode:
      node.type === "agent" ? node.config.inputSignalMode || "all" : "all",
    branchMode: "ai",
    sourceNodeId:
      node.type === "condition" || node.type === "route"
        ? node.config.sourceNodeId
        : "",
    operator: node.type === "condition" ? node.config.operator : "succeeded",
    assignments:
      node.type === "data"
        ? node.config.assignments.map((item) => ({ ...item }))
        : [],
    joinMode: node.type === "join" ? node.config.mode : "all",
    approvalPrompt:
      node.type === "approval"
        ? node.config.prompt
        : "请确认是否继续执行工作流",
    approveLabel: node.type === "approval" ? node.config.approveLabel : "批准",
    rejectLabel: node.type === "approval" ? node.config.rejectLabel : "拒绝",
    title: node.type === "notify" ? node.config.title : "工作流通知",
    body: node.type === "notify" ? node.config.body : "",
    endStatus: node.type === "end" ? node.config.status : "succeeded",
    endSummary: node.type === "end" ? node.config.summary : "工作流执行完成",
    x: position.x,
    y: position.y,
  };
}
function initializeEdit(item: WorkflowDefinition) {
  centerCanvas();
  Object.assign(form, {
    id: item.id,
    name: item.name,
    description: item.description,
    projectId: item.projectId,
    enabled: item.enabled,
    timeoutMinutes: item.timeoutMinutes,
    entryNodeIds: [
      ...(item.entryNodeIds?.length ? item.entryNodeIds : [item.entryNodeId]),
    ],
    startX: item.layout?.start?.x ?? 60,
    startY: item.layout?.start?.y ?? 180,
    nodes: item.nodes.map((node, index) => fromNode(node, index, item)),
  });
  selectedId.value = item.id;
  setSelection(["__start__"], "__start__");
  editing.value = true;
  resetHistory();
}
function edit(item: WorkflowDefinition) {
  if (!props.windowMode) {
    void window.myplane.openWorkflowEditor(item.id);
    return;
  }
  initializeEdit(item);
}
function removeNode(node: FormNode) {
  form.nodes.splice(form.nodes.indexOf(node), 1);
  for (const item of form.nodes) {
    for (const branch of item.branches) {
      branch.targetNodeIds = (branch.targetNodeIds || []).filter(
        (id) => id !== node.id,
      );
      branch.targetNodeId = branch.targetNodeIds.join("\u001f") || undefined;
    }
    if (item.sourceNodeId === node.id) item.sourceNodeId = "";
  }
  form.entryNodeIds = form.entryNodeIds.filter((id) => id !== node.id);
  if (!form.entryNodeIds.length && form.nodes[0])
    form.entryNodeIds = [form.nodes[0].id];
  setSelection(["__start__"], "__start__");
}
function deleteSelected() {
  const ids = new Set(
    [...selectedNodeIds.value].filter((id) => id !== "__start__"),
  );
  if (!ids.size) return;
  for (const node of [...form.nodes]) if (ids.has(node.id)) removeNode(node);
  setSelection(["__start__"], "__start__");
}
function payload(): WorkflowDefinitionInput {
  const nodes = form.nodes.map((node) => {
    const base = {
      id: node.id,
      name: node.name,
      branches: node.branches.map(({ targetNodeId: _legacy, ...branch }) => ({
        ...branch,
        targetNodeIds: [...(branch.targetNodeIds || [])],
      })),
    };
    if (node.type === "agent")
      return {
        ...base,
        type: "agent" as const,
        config: {
          instruction: node.instruction,
          modelSource: node.modelSource,
          ...(node.modelSource === "specified" && node.model.trim()
            ? { model: node.model.trim() }
            : {}),
          mode: node.mode,
          maxSteps: Number(node.maxSteps),
          fastMode: node.fastMode,
          approvalMode: node.approvalMode,
          inputs: node.inputs.map((parameter) => ({ ...parameter })),
          inputSignalMode: node.inputSignalMode,
          branchMode: node.branchMode,
        },
      };
    if (node.type === "condition")
      return {
        ...base,
        type: "condition" as const,
        config: { sourceNodeId: node.sourceNodeId, operator: node.operator },
      };
    if (node.type === "route")
      return {
        ...base,
        type: "route" as const,
        config: { sourceNodeId: node.sourceNodeId },
      };
    if (node.type === "data")
      return {
        ...base,
        type: "data" as const,
        config: { assignments: node.assignments.map((item) => ({ ...item })) },
      };
    if (node.type === "join")
      return {
        ...base,
        type: "join" as const,
        config: { mode: node.joinMode },
      };
    if (node.type === "approval")
      return {
        ...base,
        type: "approval" as const,
        config: {
          prompt: node.approvalPrompt,
          approveLabel: node.approveLabel,
          rejectLabel: node.rejectLabel,
        },
      };
    if (node.type === "end")
      return {
        ...base,
        type: "end" as const,
        branches: [],
        config: { status: node.endStatus, summary: node.endSummary },
      };
    return {
      ...base,
      type: "notify" as const,
      config: { title: node.title, body: node.body },
    };
  });
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    description: form.description,
    projectId: form.projectId,
    enabled: form.enabled,
    timeoutMinutes: Number(form.timeoutMinutes),
    entryNodeId: form.entryNodeIds[0] || "",
    entryNodeIds: [...form.entryNodeIds],
    nodes,
    layout: {
      nodes: Object.fromEntries(
        form.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
      ),
      start: { x: form.startX, y: form.startY },
    },
  };
}
async function save() {
  error.value = "";
  if (!form.name.trim()) {
    error.value = "请先填写工作流名称";
    setSelection(["__start__"], "__start__");
    return;
  }
  if (inputConnectionErrors.value.length) {
    error.value = "请先修复 Agent 分支的输出 JSON 格式";
    return;
  }
  busy.value = "save";
  try {
    const item = await api("workflowSave", payload());
    selectedId.value = item.id;
    if (props.windowMode) {
      ElMessage.success(`工作流 v${item.version} 已保存`);
      await window.myplane.workflowEditorSaved(item.id);
    } else {
      await load();
      editing.value = false;
      ElMessage.success(`工作流 v${item.version} 已保存`);
    }
  } catch (cause) {
    error.value = String(cause).replace(/^Error: /, "");
  } finally {
    busy.value = "";
  }
}
async function action(
  item: WorkflowDefinition,
  action: "run" | "enable" | "pause",
) {
  busy.value = item.id + action;
  try {
    await api("workflowAction", { id: item.id, action });
    await load();
    if (action === "run") ElMessage.success("已创建工作流运行");
  } catch (cause) {
    ElMessage.error(String(cause));
  } finally {
    busy.value = "";
  }
}
async function remove(item: WorkflowDefinition) {
  try {
    await ElMessageBox.confirm(
      `删除“${item.name}”及其运行历史？`,
      "删除工作流",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
    await api("workflowDelete", { id: item.id });
    await load();
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") ElMessage.error(String(cause));
  }
}
async function cancel(run: WorkflowRun) {
  await api("workflowCancel", { runId: run.id });
  await load();
}
async function retry(run: WorkflowRun, nodeId: string) {
  await api("workflowRetry", { runId: run.id, nodeId });
  await load();
  ElMessage.success("已从失败节点创建新的运行");
}
async function resolveApproval(
  run: WorkflowRun,
  decision: "approved" | "rejected",
) {
  await api("workflowResolveApproval", { runId: run.id, decision });
  await load();
  ElMessage.success(
    decision === "approved" ? "已批准继续执行" : "已拒绝继续执行",
  );
}
function canvasPoint(event: PointerEvent) {
  const box = canvas.value?.getBoundingClientRect();
  return {
    x: (event.clientX - (box?.left || 0)) / zoom.value,
    y: (event.clientY - (box?.top || 0)) / zoom.value,
  };
}
function beginSelectionDrag(id: string, event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectNode(id, event);
  const ids = selectedNodeIds.value.has(id)
      ? selectedNodeIds.value
      : new Set([id]),
    positions = new Map(
      form.nodes
        .filter((item) => ids.has(item.id))
        .map((item) => [item.id, { x: item.x, y: item.y }]),
    );
  if (ids.has("__start__"))
    positions.set("__start__", { x: form.startX, y: form.startY });
  drag.value = { clientX: event.clientX, clientY: event.clientY, positions };
}
function beginDrag(node: FormNode, event: PointerEvent) {
  beginSelectionDrag(node.id, event);
}
function beginStartDrag(event: PointerEvent) {
  beginSelectionDrag("__start__", event);
}
function beginCanvasAction(event: PointerEvent) {
  edgeMenu.value = undefined;
  if (event.button === 1 || (event.button === 0 && spacePressed)) {
    event.preventDefault();
    pan.value = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewport.x,
      y: viewport.y,
    };
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect(),
    x = event.clientX - box.left,
    y = event.clientY - box.top,
    mode = selectionMode(event),
    initial = new Set(selectedNodeIds.value);
  selectionBox.value = {
    startX: x,
    startY: y,
    x,
    y,
    width: 0,
    height: 0,
    mode,
    initial,
  };
  if (mode === "replace") setSelection([]);
}
function beginConnection(
  sourceId: string,
  branch: Branch,
  event: PointerEvent,
  mode: "add" | "replace" = "add",
  originalTargetId?: string,
) {
  event.preventDefault();
  event.stopPropagation();
  edgeMenu.value = undefined;
  const from = portPoint(sourceId, branch);
  connection.value = {
    sourceId,
    branch,
    mode,
    originalTargetId,
    x1: from.x,
    y1: from.y,
    x2: from.x,
    y2: from.y,
  };
}
function selectEdge(edge: CanvasEdge) {
  selectedNodeIds.value = new Set();
  selectedNodeId.value = "";
  selectedEdgeKey.value = {
    sourceId: edge.sourceId,
    branch: edge.branch,
    targetId: edge.targetId,
  };
}
function isEdgeSelected(edge: CanvasEdge) {
  return (
    selectedEdgeKey.value?.sourceId === edge.sourceId &&
    selectedEdgeKey.value.branch === edge.branch &&
    selectedEdgeKey.value.targetId === edge.targetId
  );
}
function beginEdgeRewire(edge: CanvasEdge, event: PointerEvent) {
  if (event.button !== 0 && event.button !== 2) return;
  selectEdge(edge);
  edgeMenu.value = undefined;
  beginConnection(
    edge.sourceId,
    edge.branch,
    event,
    event.button === 2 ? "replace" : "add",
    edge.targetId,
  );
  const point = canvasPoint(event);
  if (connection.value) {
    connection.value.x2 = point.x;
    connection.value.y2 = point.y;
  }
}
function openEdgeMenu(edge: CanvasEdge, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (Date.now() < suppressEdgeMenuUntil) return;
  selectEdge(edge);
  edgeMenu.value = {
    edge,
    x: Math.min(event.clientX, window.innerWidth - 245),
    y: Math.min(event.clientY, window.innerHeight - 112),
  };
}
function deleteEdge(edge: CanvasEdge) {
  if (edge.sourceId === "__start__")
    form.entryNodeIds = form.entryNodeIds.filter((id) => id !== edge.targetId);
  else {
    const branch = nodeById.value
      .get(edge.sourceId)
      ?.branches.find((item) => item.id === edge.branch);
    if (branch) {
      branch.targetNodeIds = (branch.targetNodeIds || []).filter(
        (id) => id !== edge.targetId,
      );
      branch.targetNodeId = branch.targetNodeIds.join("\u001f") || undefined;
    }
  }
  edgeMenu.value = undefined;
  selectedEdgeKey.value = undefined;
}
function edgeNodeName(id: string): string {
  if (id.includes("\u001f"))
    return id.split("\u001f").map(edgeNodeName).join("、");
  return id === "__start__"
    ? "开始"
    : nodeById.value.get(id)?.name || "节点已移除";
}
function edgeBranchName(edge: CanvasEdge) {
  return edge.branch === "start"
    ? "开始入口"
    : nodeById.value
        .get(edge.sourceId)
        ?.branches.find((item) => item.id === edge.branch)?.name || edge.label;
}
function completeConnection(targetId: string, event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();
  const draft = connection.value;
  if (!draft || draft.sourceId === targetId) return;
  if (draft.sourceId === "__start__") {
    const targets = [...form.entryNodeIds];
    if (draft.mode === "replace" && draft.originalTargetId) {
      const index = targets.indexOf(draft.originalTargetId);
      if (index >= 0 && !targets.includes(targetId)) targets[index] = targetId;
      suppressEdgeMenuUntil = Date.now() + 350;
    } else if (!targets.includes(targetId)) targets.push(targetId);
    form.entryNodeIds = targets;
  } else {
    const branch = nodeById.value
      .get(draft.sourceId)
      ?.branches.find((item) => item.id === draft.branch);
    if (branch) {
      const targets = [...(branch.targetNodeIds || [])];
      if (draft.mode === "replace" && draft.originalTargetId) {
        const index = targets.indexOf(draft.originalTargetId);
        if (index >= 0 && !targets.includes(targetId))
          targets[index] = targetId;
        suppressEdgeMenuUntil = Date.now() + 350;
      } else if (!targets.includes(targetId)) targets.push(targetId);
      branch.targetNodeIds = targets;
      branch.targetNodeId = targets.join("\u001f") || undefined;
    }
  }
  connection.value = undefined;
}
const branchColors = [
  "#347fc5",
  "#c98a18",
  "#8058b4",
  "#2f9b74",
  "#d45b68",
  "#3a9da8",
  "#9b6b43",
  "#6677cc",
];
function addBranch(node: FormNode) {
  const index = node.branches.length,
    used = new Set(node.branches.map((branch) => branch.color.toLowerCase())),
    color =
      branchColors.find((value) => !used.has(value.toLowerCase())) ||
      branchColors[index % branchColors.length],
    output =
      node.type === "agent" && node.branchMode === "ai"
        ? '{"result":""}'
        : undefined;
  node.branches.push({
    id: `branch_${Date.now().toString(36)}_${++nodeSequence}`,
    name: `分支 ${index + 1}`,
    condition: "",
    color,
    targetNodeIds: [],
    ...(output ? { outputValue: output } : {}),
  });
}
function removeBranch(node: FormNode, branch: FormBranch) {
  node.branches.splice(node.branches.indexOf(branch), 1);
  if (
    selectedEdgeKey.value?.sourceId === node.id &&
    selectedEdgeKey.value.branch === branch.id
  )
    selectedEdgeKey.value = undefined;
}
function addAgentInput(node: FormNode) {
  node.inputs.push({ name: "", description: "" });
}
function removeAgentInput(node: FormNode, index: number) {
  node.inputs.splice(index, 1);
}
function agentInputJson(node: FormNode) {
  return JSON.stringify(
    Object.fromEntries(
      node.inputs.map((item, index) => [
        item.name.trim() || `参数${index + 1}`,
        "",
      ]),
    ),
    null,
    2,
  );
}
function addAssignment(node: FormNode) {
  node.assignments.push({ name: "", value: "" });
}
function removeAssignment(node: FormNode, index: number) {
  node.assignments.splice(index, 1);
}
function pointerMove(event: PointerEvent) {
  if (pan.value) {
    viewport.x = Math.round(pan.value.x + event.clientX - pan.value.clientX);
    viewport.y = Math.round(pan.value.y + event.clientY - pan.value.clientY);
  }
  if (drag.value) {
    for (const [id, position] of drag.value.positions) {
      const x = Math.round(
          position.x + (event.clientX - drag.value.clientX) / zoom.value,
        ),
        y = Math.round(
          position.y + (event.clientY - drag.value.clientY) / zoom.value,
        );
      if (id === "__start__") {
        form.startX = x;
        form.startY = y;
      } else {
        const node = nodeById.value.get(id);
        if (node) {
          node.x = x;
          node.y = y;
        }
      }
    }
  }
  if (selectionBox.value) {
    const host = canvasHost.value?.getBoundingClientRect();
    if (host) {
      const currentX = event.clientX - host.left,
        currentY = event.clientY - host.top,
        box = selectionBox.value;
      box.x = Math.min(box.startX, currentX);
      box.y = Math.min(box.startY, currentY);
      box.width = Math.abs(currentX - box.startX);
      box.height = Math.abs(currentY - box.startY);
      const hits = new Set<string>(),
        intersects = (x: number, y: number, width: number, height: number) =>
          x < box.x + box.width &&
          x + width > box.x &&
          y < box.y + box.height &&
          y + height > box.y;
      if (
        intersects(
          form.startX * zoom.value + viewport.x,
          form.startY * zoom.value + viewport.y,
          150 * zoom.value,
          78 * zoom.value,
        )
      )
        hits.add("__start__");
      for (const node of form.nodes)
        if (
          intersects(
            node.x * zoom.value + viewport.x,
            node.y * zoom.value + viewport.y,
            230 * zoom.value,
            nodeHeight(node) * zoom.value,
          )
        )
          hits.add(node.id);
      const next =
        box.mode === "replace" ? new Set<string>() : new Set(box.initial);
      if (box.mode === "replace" || box.mode === "add")
        for (const id of hits) next.add(id);
      else if (box.mode === "subtract") for (const id of hits) next.delete(id);
      else
        for (const id of hits)
          box.initial.has(id) ? next.delete(id) : next.add(id);
      setSelection(next);
    }
  }
  if (connection.value) {
    const point = canvasPoint(event);
    connection.value.x2 = point.x;
    connection.value.y2 = point.y;
  }
}
function pointerUp() {
  drag.value = undefined;
  pan.value = undefined;
  selectionBox.value = undefined;
  connection.value = undefined;
}
function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element?.closest('input,textarea,select,[contenteditable="true"]');
}
function keyDown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (isEditableTarget(event.target)) return;
  if (event.code === "Space") {
    spacePressed = true;
    event.preventDefault();
  } else if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "a"
  ) {
    event.preventDefault();
    setSelection(
      ["__start__", ...form.nodes.map((node) => node.id)],
      selectedNodeId.value,
    );
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    if (selectedEdge.value) deleteEdge(selectedEdge.value);
    else deleteSelected();
  }
}
function keyUp(event: KeyboardEvent) {
  if (event.code === "Space") spacePressed = false;
}
function centerCanvas() {
  viewport.x = 0;
  viewport.y = 0;
}
function setZoom(value: number, anchor?: { x: number; y: number }) {
  const next = Math.max(0.25, Math.min(2, Math.round(value * 20) / 20));
  if (next === zoom.value) return;
  const host = canvasHost.value?.getBoundingClientRect(),
    point = anchor || {
      x: (host?.width || 800) / 2,
      y: (host?.height || 600) / 2,
    },
    contentX = (point.x - viewport.x) / zoom.value,
    contentY = (point.y - viewport.y) / zoom.value;
  viewport.x = Math.round(point.x - contentX * next);
  viewport.y = Math.round(point.y - contentY * next);
  zoom.value = next;
}
function zoomWheel(event: WheelEvent) {
  const host = canvasHost.value?.getBoundingClientRect();
  if (!host) return;
  setZoom(zoom.value * (event.deltaY < 0 ? 1.1 : 0.9), {
    x: event.clientX - host.left,
    y: event.clientY - host.top,
  });
}
function setZoomPercent(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  setZoom(Number(input.value) / 100);
  input.value = String(Math.round(zoom.value * 100));
}
function resetZoom() {
  setZoom(1);
}
function autoLayout() {
  form.startX = 60;
  form.startY = 180;
  form.nodes.forEach((node, index) => {
    node.x = 330 + (index % 3) * 290;
    node.y = 100 + Math.floor(index / 3) * 190;
  });
  centerCanvas();
}
function closeEditor() {
  if (props.windowMode) void window.myplane.closeWorkflowEditor();
  else editing.value = false;
}
watch(
  () => props.model,
  (value) => {
    for (const node of form.nodes) if (!node.model) node.model = value;
  },
);
watch(form, scheduleHistory, { deep: true, flush: "sync" });
onMounted(async () => {
  await load();
  if (props.windowMode) {
    const item = props.workflowId
      ? definitions.value.find((value) => value.id === props.workflowId)
      : undefined;
    if (props.workflowId && !item) error.value = "找不到要编辑的工作流";
    else if (item) initializeEdit(item);
    else initializeNew();
  } else {
    timer = setInterval(() => void load(), 4000);
    disposeSaved = window.myplane.onWorkflowSaved(() => void load());
  }
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (historyTimer) clearTimeout(historyTimer);
  disposeSaved?.();
  window.removeEventListener("pointermove", pointerMove);
  window.removeEventListener("pointerup", pointerUp);
  window.removeEventListener("keydown", keyDown);
  window.removeEventListener("keyup", keyUp);
});
</script>

<template>
  <main v-if="!windowMode" class="workflow-page scroll-page">
    <header class="workflow-header">
      <div>
        <span class="eyebrow">WORKFLOWS</span>
        <h1>工作流</h1>
        <p>组合智能任务、确定性路由、数据、人工确认和系统动作。</p>
      </div>
      <button
        class="primary-button"
        :disabled="!projects.length"
        @click="create"
      >
        <Plus />新建工作流
      </button>
    </header>
    <div v-if="error && !editing" class="workflow-error">
      {{ error }}<button @click="error = ''">关闭</button>
    </div>
    <section class="workflow-stats">
      <div>
        <strong>{{ definitions.length }}</strong
        ><span>工作流</span>
      </div>
      <div>
        <strong>{{ running }}</strong
        ><span>运行中</span>
      </div>
      <div>
        <strong>{{ runs.length }}</strong
        ><span>历史运行</span>
      </div>
    </section>
    <div class="workflow-grid">
      <section class="workflow-list">
        <header>
          <h2>流程</h2>
          <button class="icon-btn" @click="load"><RefreshRight /></button>
        </header>
        <p v-if="!definitions.length" class="workflow-empty">暂无工作流</p>
        <article
          v-for="item in definitions"
          :key="item.id"
          :class="{ selected: selectedId === item.id }"
          @click="
            selectedId = item.id;
            historyId = item.id;
          "
        >
          <div>
            <span class="workflow-state" :class="{ enabled: item.enabled }">{{
              item.enabled ? "已启用" : "已暂停"
            }}</span
            ><small>v{{ item.version }}</small>
          </div>
          <h3>{{ item.name }}</h3>
          <p>
            {{ item.nodes.length }} 个节点
          </p>
          <div class="workflow-actions">
            <button @click.stop="action(item, 'run')"><VideoPlay />运行</button
            ><button
              @click.stop="action(item, item.enabled ? 'pause' : 'enable')"
            >
              <component :is="item.enabled ? VideoPause : VideoPlay" />{{
                item.enabled ? "暂停" : "启用"
              }}</button
            ><button @click.stop="edit(item)"><Edit />编辑</button
            ><button class="danger" @click.stop="remove(item)">
              <Delete />
            </button>
          </div>
        </article>
      </section>
      <section class="workflow-detail">
        <div class="workflow-history">
          <header>
            <div>
              <span class="eyebrow">RUN HISTORY</span>
              <h2>
                {{ selected ? selected.name + " · 运行历史" : "全部运行历史" }}
              </h2>
            </div>
            <button
              v-if="historyId"
              class="text-button"
              @click="
                historyId = '';
                selectedId = '';
              "
            >
              查看全部
            </button>
          </header>
          <p v-if="!visibleRuns.length" class="workflow-empty">暂无运行记录</p>
          <article
            v-for="run in visibleRuns"
            :key="run.id"
            class="workflow-run"
          >
            <header>
              <div>
                <strong>{{ run.workflowName }}</strong
                ><small
                  >v{{ run.workflowVersion }} · {{ date(run.startedAt) }}</small
                >
              </div>
              <span class="workflow-run-status" :class="run.status">{{
                status(run.status)
              }}</span>
            </header>
            <div class="node-timeline">
              <div
                v-for="node in run.nodeRuns"
                :key="node.nodeId + node.startedAt"
                :class="node.status"
              >
                <i></i>
                <div>
                  <strong>{{ node.nodeName }}</strong
                  ><small
                    >{{ status(node.status) }} · {{ node.type }} ·
                    {{ date(node.finishedAt || node.startedAt) }}</small
                  >
                  <p v-if="node.summary">{{ node.summary }}</p>
                  <p v-if="node.error" class="danger">{{ node.error }}</p>
                  <div
                    v-if="
                      node.type === 'approval' &&
                      node.status === 'waiting' &&
                      run.status === 'waiting'
                    "
                    class="workflow-approval-actions"
                  >
                    <button @click="resolveApproval(run, 'approved')">
                      <Check />{{
                        node.approval?.approveLabel || "批准继续"
                      }}</button
                    ><button
                      class="danger"
                      @click="resolveApproval(run, 'rejected')"
                    >
                      <Close />{{ node.approval?.rejectLabel || "拒绝" }}
                    </button>
                  </div>
                  <button
                    v-if="
                      node.status === 'failed' &&
                      ['failed', 'cancelled'].includes(run.status)
                    "
                    @click="retry(run, node.nodeId)"
                  >
                    <RefreshRight />从此节点重试
                  </button>
                </div>
              </div>
            </div>
            <p v-if="run.error" class="danger">{{ run.error }}</p>
            <details v-if="run.logs?.length" class="workflow-run-logs">
              <summary>执行日志（{{ run.logs.length }}）</summary>
              <ol>
                <li v-for="entry in run.logs" :key="entry.at + entry.message" :class="entry.level">
                  <time>{{ date(entry.at) }}</time>
                  <span>{{ entry.message }}</span>
                </li>
              </ol>
            </details>
            <button
              v-if="['running', 'waiting'].includes(run.status)"
              class="secondary-button"
              @click="cancel(run)"
            >
              <VideoPause />取消运行
            </button>
          </article>
        </div>
      </section>
    </div>
  </main>

  <Teleport to="body" :disabled="windowMode"
    ><form
      v-if="editing"
      class="workflow-editor-window"
      :class="{ 'is-native-window': windowMode, 'is-connecting': !!connection }"
      role="dialog"
      aria-modal="true"
      aria-label="工作流画布编辑器"
      @submit.prevent="save"
      @keydown.esc.prevent="closeEditor"
    >
      <header class="workflow-editor-header">
        <div>
          <span class="eyebrow">VISUAL WORKFLOW</span
          ><strong>{{ form.name || "未命名工作流" }}</strong
          ><small>端口拖动创建连线；已有连线左拖新增目标、右拖切换目标</small>
        </div>
        <div>
          <span class="workflow-save-state"
            >{{ form.id ? "编辑已有流程" : "新流程" }} ·
            {{ form.nodes.length }} 个节点</span
          ><button type="button" class="secondary-button" @click="closeEditor">
            <Close />关闭</button
          ><button class="primary-button" :disabled="busy === 'save'">
            <Check />{{ busy === "save" ? "保存中…" : "保存工作流" }}
          </button>
        </div>
      </header>
      <div v-if="error" class="workflow-editor-error">
        {{ error }}<button type="button" @click="error = ''">关闭</button>
      </div>
      <div
        v-if="inputConnectionErrors.length"
        class="workflow-editor-error workflow-connection-errors"
      >
        <div>
          <strong>发现 {{ inputConnectionErrors.length }} 条输入连线错误</strong
          ><span v-for="message in inputConnectionErrors" :key="message">{{
            message
          }}</span>
        </div>
      </div>
      <div class="workflow-editor-body">
        <section class="workflow-canvas-pane">
          <div class="workflow-canvas-toolbar">
            <div class="workflow-component-buttons">
              <button
                type="button"
                class="agent"
                title="添加智能任务"
                @click="addNode('agent')"
              >
                <Cpu />Agent</button
              ><button
                type="button"
                class="route"
                title="添加确定性条件路由"
                @click="addNode('route')"
              >
                <Guide />路由</button
              ><button
                type="button"
                class="data"
                title="添加变量与数据映射"
                @click="addNode('data')"
              >
                <DataAnalysis />数据</button
              ><button
                type="button"
                class="join"
                title="汇合多个上游分支"
                @click="addNode('join')"
              >
                <Connection />汇合</button
              ><button
                type="button"
                class="approval"
                title="等待人工批准或拒绝"
                @click="addNode('approval')"
              >
                <UserFilled />确认</button
              ><button
                type="button"
                class="notify"
                title="发送系统桌面通知"
                @click="addNode('notify')"
              >
                <Bell />通知</button
              ><button
                type="button"
                class="end"
                title="明确流程结束状态"
                @click="addNode('end')"
              >
                <Flag />结束
              </button>
              <div class="workflow-history-control">
                <button
                  type="button"
                  title="撤销 (Ctrl/Cmd+Z)"
                  :disabled="!canUndo"
                  @click="undo"
                >
                  <RefreshLeft />撤销</button
                ><button
                  type="button"
                  title="重做 (Ctrl/Cmd+Shift+Z / Ctrl+Y)"
                  :disabled="!canRedo"
                  @click="redo"
                >
                  <RefreshRight />重做
                </button>
              </div>
            </div>
            <div>
              <span class="workflow-canvas-tip"
                >左拖框选 · Shift 追加 · Alt 减选 · 空格拖动画布</span
              >
              <div class="workflow-zoom-control">
                <button
                  type="button"
                  title="缩小画布"
                  aria-label="缩小画布"
                  :disabled="zoom <= 0.25"
                  @click="setZoom(zoom - 0.1)"
                >
                  <ZoomOut /></button
                ><label
                  ><input
                    type="number"
                    min="25"
                    max="200"
                    step="5"
                    :value="Math.round(zoom * 100)"
                    aria-label="画布缩放百分比"
                    @change="setZoomPercent"
                  /><span>%</span></label
                ><button
                  type="button"
                  title="放大画布"
                  aria-label="放大画布"
                  :disabled="zoom >= 2"
                  @click="setZoom(zoom + 0.1)"
                >
                  <ZoomIn /></button
                ><button
                  type="button"
                  title="恢复 100%"
                  aria-label="恢复百分百缩放"
                  @click="resetZoom"
                >
                  <ScaleToOriginal />
                </button>
              </div>
              <button
                type="button"
                title="将画布平移回初始位置"
                @click="centerCanvas"
              >
                <Position />回到原点</button
              ><button
                type="button"
                title="自动整理节点位置"
                @click="autoLayout"
              >
                <Rank />自动排列
              </button>
            </div>
          </div>
          <div
            ref="canvasHost"
            class="workflow-canvas-scroll"
            :class="{ 'is-selecting': !!selectionBox, 'is-panning': !!pan }"
            :style="gridPosition"
            @wheel.prevent="zoomWheel"
            @pointerdown.self="beginCanvasAction"
            @contextmenu.self.prevent
          >
            <div
              ref="canvas"
              class="workflow-canvas"
              :style="viewportTransform"
            >
              <svg class="workflow-connections" aria-label="工作流连线">
                <defs>
                  <marker
                    id="workflow-arrow-success"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" />
                  </marker>
                  <marker
                    id="workflow-arrow-failure"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" />
                  </marker>
                </defs>
                <g
                  v-for="edge in edges"
                  :key="edge.id"
                  :class="[
                    'workflow-edge',
                    {
                      selected: isEdgeSelected(edge),
                      invalid: invalidInputEdges.has(edge.id),
                    },
                  ]"
                  :style="{ '--edge-color': edge.color }"
                >
                  <path
                    class="workflow-edge-flow"
                    :d="curve(edge.from, edge.to)"
                  />
                  <path
                    class="workflow-edge-pulse"
                    :d="curve(edge.from, edge.to)"
                  />
                  <path
                    class="workflow-edge-hit"
                    :d="curve(edge.from, edge.to)"
                    @pointerdown="beginEdgeRewire(edge, $event)"
                    @contextmenu="openEdgeMenu(edge, $event)"
                  />
                  <circle
                    class="workflow-edge-handle"
                    :cx="edge.to.x"
                    :cy="edge.to.y"
                    r="6"
                    @pointerdown="beginEdgeRewire(edge, $event)"
                    @contextmenu="openEdgeMenu(edge, $event)"
                  />
                  <text
                    :x="(edge.from.x + edge.to.x) / 2"
                    :y="(edge.from.y + edge.to.y) / 2 - 6"
                  >
                    {{ edge.label }}
                  </text>
                </g>
                <path
                  v-if="connection"
                  class="workflow-edge-draft"
                  :d="
                    curve(
                      { x: connection.x1, y: connection.y1 },
                      { x: connection.x2, y: connection.y2 },
                    )
                  "
                />
              </svg>
              <article
                class="workflow-start-node"
                :class="{ selected: isSelected('__start__') }"
                :style="{ left: form.startX + 'px', top: form.startY + 'px' }"
                @pointerdown.stop="beginStartDrag"
              >
                <span>流程入口</span><strong>开始</strong
                ><small>{{
                  form.entryNodeIds.length
                    ? form.entryNodeIds.length + " 个入口节点"
                    : "拖动端口连接入口节点"
                }}</small
                ><button
                  type="button"
                  class="workflow-output-port start"
                  title="新增入口节点"
                  @pointerdown="beginConnection('__start__', 'start', $event)"
                ></button>
              </article>
              <article
                v-for="node in form.nodes"
                :key="node.id"
                class="workflow-canvas-node"
                :class="[node.type, { selected: isSelected(node.id) }]"
                :style="{
                  left: node.x + 'px',
                  top: node.y + 'px',
                  height: nodeHeight(node) + 'px',
                }"
                @pointerdown.stop="selectNode(node.id, $event)"
              >
                <button
                  type="button"
                  class="workflow-input-port"
                  title="连接到此节点"
                  @pointerup="completeConnection(node.id, $event)"
                  @contextmenu.prevent
                ></button>
                <header @pointerdown="beginDrag(node, $event)">
                  <span>{{ nodeType(node.type) }}</span
                  ><strong>{{ node.name }}</strong>
                </header>
                <p>{{ nodeSummary(node) }}</p>
                <footer>
                  <small v-if="form.entryNodeIds.includes(node.id)"
                    >入口节点 · {{ node.branches.length }} 条分支</small
                  ><small v-else>{{ node.branches.length }} 条分支</small>
                </footer>
                <button
                  v-for="(branch, branchIndex) in node.branches"
                  :key="branch.id"
                  type="button"
                  class="workflow-output-port custom"
                  :style="{
                    top: 61 + branchIndex * 28 + 'px',
                    background: branch.color,
                    boxShadow: '0 0 0 1px ' + branch.color,
                  }"
                  :title="'连接 ' + branch.name"
                  @pointerdown="beginConnection(node.id, branch.id, $event)"
                >
                  <span>{{ branch.name }}</span>
                </button>
              </article>
            </div>
            <div
              v-if="selectionBox"
              class="workflow-selection-box"
              :style="selectionStyle"
            ></div>
          </div>
          <div
            v-if="edgeMenu"
            class="workflow-edge-menu"
            :style="{ left: edgeMenu.x + 'px', top: edgeMenu.y + 'px' }"
            @pointerdown.stop
            @contextmenu.prevent
          >
            <strong>{{ edgeMenu.edge.label }}连线</strong
            ><button type="button" @click="deleteEdge(edgeMenu.edge)">
              <Delete />删除连线</button
            ><small>左键拖动新增目标，右键拖动切换当前目标</small>
          </div>
        </section>
        <aside class="workflow-inspector">
          <template v-if="selectedEdge"
            ><header>
              <Connection />
              <div>
                <strong>{{ edgeBranchName(selectedEdge) }}连线</strong
                ><small>连线属性</small>
              </div>
            </header>
            <div class="workflow-edge-properties">
              <label
                >起点<input
                  :value="edgeNodeName(selectedEdge.sourceId)"
                  disabled /></label
              ><label
                >分支类型<input
                  :value="edgeBranchName(selectedEdge)"
                  disabled /></label
              ><label
                >连接目标<input
                  :value="edgeNodeName(selectedEdge.targetId)"
                  disabled
                  title="输出目标由画布连线产生"
              /></label>
              <p>
                左键拖动高亮连线或末端圆点可新增目标；右键拖动可切换当前目标。
              </p>
              <button type="button" @click="deleteEdge(selectedEdge)">
                <Delete />删除这条连线
              </button>
            </div></template
          ><template v-else-if="selectedNodeIds.size > 1"
            ><header>
              <Connection />
              <div>
                <strong>已选择 {{ selectedNodeIds.size }} 个节点</strong
                ><small>拖动任一节点可整体移动</small>
              </div>
            </header>
            <div class="workflow-multi-selection">
              <p>Shift 追加，Ctrl/Cmd 切换，Alt 减选。</p>
              <button
                type="button"
                :disabled="
                  ![...selectedNodeIds].some((id) => id !== '__start__')
                "
                @click="deleteSelected"
              >
                <Delete />删除所选节点
              </button>
            </div></template
          ><template v-else-if="selectedNodeId === '__start__'"
            ><header>
              <Connection />
              <div>
                <strong>开始节点</strong
                ><small>每个工作流固定一个，可连接多个入口</small>
              </div>
            </header>
            <label
              >工作流名称<input
                v-model="form.name"
                required
                maxlength="100" /></label
            ><label
              >说明<textarea
                v-model="form.description"
                rows="4"
                maxlength="1000"
              ></textarea></label
            ><label
              >入口节点（可多选）<select
                v-model="form.entryNodeIds"
                required
                multiple
                :size="Math.min(5, Math.max(2, form.nodes.length))"
              >
                <option
                  v-for="node in form.nodes"
                  :key="node.id"
                  :value="node.id"
                >
                  {{ node.name }}
                </option>
              </select></label
            ><label
              >总超时（分钟）<input
                v-model.number="form.timeoutMinutes"
                type="number"
                min="1"
                max="1440" /></label
            ><label class="workflow-switch"
              ><input v-model="form.enabled" type="checkbox" />保存后启用</label
            ></template
          >
          <template v-else-if="selectedNode">
            <header>
              <component
                :is="
                  selectedNode.type === 'notify'
                    ? Bell
                    : selectedNode.type === 'agent'
                      ? Edit
                      : Connection
                "
              />
              <div>
                <strong>{{ selectedNode.name }}</strong
                ><small>{{ nodeType(selectedNode.type) }} 节点</small>
              </div>
            </header>
            <label
              >节点名称<input
                v-model="selectedNode.name"
                required
                maxlength="100" /></label
            ><label
              >节点类型<input
                :value="nodeType(selectedNode.type)"
                disabled
                title="节点类型创建后不可修改"
            /></label>
            <template v-if="selectedNode.type === 'agent'"
              ><label
                >执行内容<textarea
                  v-model="selectedNode.instruction"
                  rows="8"
                  required
                  placeholder="描述任务；可引用 {{variables.name}} 或 {{节点ID.summary}}"
                ></textarea>
              </label>
              <section class="workflow-agent-inputs">
                <header>
                  <div>
                    <strong>输入参数</strong
                    ><small
                      >参数名自动拼接为 JSON；说明仅供 AI 理解字段语义</small
                    >
                  </div>
                  <button type="button" @click="addAgentInput(selectedNode)">
                    <Plus />添加参数
                  </button>
                </header>
                <article
                  v-for="(parameter, index) in selectedNode.inputs"
                  :key="index"
                >
                  <header>
                    <strong>参数 {{ index + 1 }}</strong
                    ><button
                      type="button"
                      title="删除参数"
                      @click="removeAgentInput(selectedNode, index)"
                    >
                      <Delete />
                    </button>
                  </header>
                  <label
                    >参数名称<input
                      v-model="parameter.name"
                      required
                      maxlength="100" /></label
                  ><label
                    >参数说明<textarea
                      v-model="parameter.description"
                      rows="3"
                      maxlength="4000"
                      placeholder="例如：待分析的项目名称"
                    ></textarea>
                  </label>
                </article>
                <label
                  >输入 JSON 预览<textarea
                    :value="agentInputJson(selectedNode)"
                    rows="5"
                    readonly
                  ></textarea>
                </label>
              </section>
              <p class="workflow-field-note">
                AI 会基于自然语言条件互斥选择一个分支，并按该分支的 JSON
                格式输出属性值。
              </p>
              <label
                >模型来源<select v-model="selectedNode.modelSource">
                  <option value="current">跟随当前连接模型</option>
                  <option value="specified">指定模型 ID</option>
                </select></label
              ><label v-if="selectedNode.modelSource === 'specified'"
                >模型 ID<input
                  v-model="selectedNode.model"
                  list="workflow-models"
                  required
                  placeholder="选择当前服务可用的模型 ID"
              /></label>
              ><p
                v-if="selectedNode.modelSource === 'current'"
                class="workflow-field-note"
              >
                运行时使用当前连接的模型；切换连接后自动生效。
              </p>
              <div class="workflow-inspector-grid">
                <label
                  >模式<select v-model="selectedNode.mode">
                    <option value="coding">编码</option>
                    <option value="general">通用</option>
                    <option value="documents">文档</option>
                  </select></label
                ><label
                  >最大步骤<input
                    v-model.number="selectedNode.maxSteps"
                    type="number"
                    min="1"
                    max="500"
                /></label>
              </div>
              <label
                >权限<select v-model="selectedNode.approvalMode">
                  <option value="ask">安全</option>
                  <option value="auto">标准自动</option>
                  <option value="full">自主</option>
                  <option value="unrestricted">完全控制</option>
                </select></label
              ></template
            >
            <template v-else-if="selectedNode.type === 'condition'"
              ><p class="workflow-legacy-note">
                这是旧版判断节点。建议改用路由节点。
              </p>
              <label
                >判断来源<select v-model="selectedNode.sourceNodeId" required>
                  <option value="" disabled>选择此前节点</option>
                  <option
                    v-for="candidate in nodeCandidates"
                    :key="candidate.id"
                    :value="candidate.id"
                  >
                    {{ candidate.name }}
                  </option>
                </select></label
              ><label
                >判断内容<select v-model="selectedNode.operator">
                  <option value="succeeded">来源节点执行成功</option>
                  <option value="failed">来源节点执行失败</option>
                </select></label
              ></template
            >
            <template v-else-if="selectedNode.type === 'route'"
              ><label
                >路由依据<select v-model="selectedNode.sourceNodeId" required>
                  <option value="" disabled>选择此前节点</option>
                  <option
                    v-for="candidate in nodeCandidates"
                    :key="candidate.id"
                    :value="candidate.id"
                  >
                    {{ candidate.name }}
                  </option>
                </select></label
              >
              <p class="workflow-field-note">
                路由按分支顺序选择首个匹配项；最后可添加“始终”作为默认分支。
              </p></template
            >
            <template v-else-if="selectedNode.type === 'data'"
              ><section class="workflow-agent-inputs">
                <header>
                  <div>
                    <strong>工作流变量</strong
                    ><small
                      >后续节点通过
                      <code v-text="'{{variables.name}}'"></code> 引用</small
                    >
                  </div>
                  <button type="button" @click="addAssignment(selectedNode)">
                    <Plus />添加变量
                  </button>
                </header>
                <article
                  v-for="(assignment, index) in selectedNode.assignments"
                  :key="index"
                >
                  <header>
                    <strong>变量 {{ index + 1 }}</strong
                    ><button
                      type="button"
                      title="删除变量"
                      @click="removeAssignment(selectedNode, index)"
                    >
                      <Delete />
                    </button>
                  </header>
                  <label
                    >名称<input
                      v-model="assignment.name"
                      required
                      maxlength="80"
                      placeholder="例如 reportTitle" /></label
                  ><label
                    >值<textarea
                      v-model="assignment.value"
                      rows="3"
                      maxlength="4000"
                      placeholder="支持 {{variables.name}} 和 {{节点ID.summary}}"
                    ></textarea>
                  </label>
                </article></section
            ></template>
            <template v-else-if="selectedNode.type === 'join'"
              ><label
                >汇合方式<select v-model="selectedNode.joinMode">
                  <option value="all">等待全部上游</option>
                  <option value="any">任一上游到达</option></select
                ><small
                  >当前有
                  {{ incomingSourceCount(selectedNode.id) }} 个上游连接。</small
                ></label
              ></template
            >
            <template v-else-if="selectedNode.type === 'approval'"
              ><label
                >确认内容<textarea
                  v-model="selectedNode.approvalPrompt"
                  required
                  rows="5"
                  maxlength="1000"
                  placeholder="支持工作流变量模板"
                ></textarea>
              </label>
              <div class="workflow-inspector-grid">
                <label
                  >批准按钮<input
                    v-model="selectedNode.approveLabel"
                    required
                    maxlength="30" /></label
                ><label
                  >拒绝按钮<input
                    v-model="selectedNode.rejectLabel"
                    required
                    maxlength="30"
                /></label>
              </div>
              <p class="workflow-field-note">
                运行会暂停并在运行历史中等待处理。批准匹配“执行成功”，拒绝匹配“执行失败”。
              </p></template
            >
            <template v-else-if="selectedNode.type === 'notify'"
              ><label
                >通知标题<input
                  v-model="selectedNode.title"
                  required
                  maxlength="120"
                  placeholder="支持 {{variables.name}}" /></label
              ><label
                >通知内容<textarea
                  v-model="selectedNode.body"
                  rows="6"
                  required
                  maxlength="1000"
                  placeholder="支持工作流变量模板"
                ></textarea>
              </label>
              <p class="workflow-field-note">
                系统通知用于用户未停留在应用中时提醒关键结果。
              </p></template
            >
            <template v-else-if="selectedNode.type === 'end'"
              ><label
                >结束状态<select v-model="selectedNode.endStatus">
                  <option value="succeeded">成功结束</option>
                  <option value="failed">失败结束</option>
                </select></label
              ><label
                >最终摘要<textarea
                  v-model="selectedNode.endSummary"
                  rows="5"
                  maxlength="1000"
                  placeholder="支持工作流变量模板"
                ></textarea></label
            ></template>
            <section
              v-if="selectedNode.type !== 'end'"
              class="workflow-branches"
            >
              <header>
                <div>
                  <h3>
                    {{
                      selectedNode.type === "route" ? "路由规则" : "输出分支"
                    }}
                  </h3>
                  <small>{{
                    selectedNode.type === "agent" &&
                    selectedNode.branchMode === "ai"
                      ? "分支之间为或关系；每次只选择一个"
                      : "按顺序匹配第一条规则"
                  }}</small>
                </div>
                <button type="button" @click="addBranch(selectedNode)">
                  <Plus />添加分支
                </button>
              </header>
              <p
                v-if="!selectedNode.branches.length"
                class="workflow-branches-empty"
              >
                没有分支时，节点完成后当前路径结束。
              </p>
              <article
                v-for="(branch, index) in selectedNode.branches"
                :key="branch.id"
              >
                <header>
                  <strong>分支 {{ index + 1 }}</strong
                  ><button
                    type="button"
                    title="删除分支"
                    @click="removeBranch(selectedNode, branch)"
                  >
                    <Delete />
                  </button>
                </header>
                <div class="workflow-branch-name">
                  <label
                    >名称<input
                      v-model="branch.name"
                      required
                      maxlength="80" /></label
                  ><label
                    >颜色<input v-model="branch.color" type="color" required
                  /></label>
                </div>
                <label
                  >{{
                    selectedNode.type === "agent" &&
                    selectedNode.branchMode === "ai"
                      ? "AI 识别条件"
                      : "匹配条件"
                  }}<textarea
                    v-if="
                      selectedNode.type === 'agent' &&
                      selectedNode.branchMode === 'ai'
                    "
                    v-model="branch.condition"
                    required
                    rows="3"
                    maxlength="500"
                    placeholder="用自然语言描述什么情况下应选择此分支"
                  ></textarea
                  ><input
                    v-else
                    v-model="branch.condition"
                    required
                    maxlength="500"
                    list="workflow-branch-conditions"
                    placeholder="例如 变量：risk 等于：high" /></label
                ><small>{{
                  selectedNode.type === "agent" &&
                  selectedNode.branchMode === "ai"
                    ? "描述业务语义，AI 将在所有分支中选择唯一最符合的一条。"
                    : "支持执行状态、摘要/错误包含，以及变量等于、不等于、包含、大小或为空。"
                }}</small
                ><template
                  v-if="
                    selectedNode.type === 'agent' &&
                    selectedNode.branchMode === 'ai'
                  "
                  ><label
                    >输出 JSON 格式<textarea
                      v-model="branch.outputValue"
                      rows="4"
                      maxlength="4000"
                      placeholder='{"result":"","reason":""}'
                    ></textarea></label
                  ><small
                    :class="{ danger: outputJsonError(branch.outputValue) }"
                    >{{
                      outputJsonError(branch.outputValue) ||
                      "JSON 有效；所有属性值保持留空字符串，AI 会填充实际值。"
                    }}</small
                  ></template
                ><label v-else
                  >输出值（可选）<textarea
                    v-model="branch.outputValue"
                    rows="2"
                    maxlength="4000"
                    placeholder="支持模板变量"
                  ></textarea>
                </label>
              </article>
            </section>
            <button
              type="button"
              class="workflow-delete-node"
              @click="removeNode(selectedNode)"
            >
              <Delete />删除此节点
            </button>
          </template>
        </aside>
      </div>
      <datalist id="workflow-models">
        <option
          v-for="item in models"
          :key="item.id"
          :value="item.id"
        >{{ item.name || item.id }}</option></datalist
      ><datalist id="workflow-branch-conditions">
        <option value="执行成功"></option>
        <option value="执行失败"></option>
        <option value="始终"></option>
        <option value="摘要包含："></option>
        <option value="错误包含："></option>
        <option value="变量：name 等于：value"></option>
        <option value="变量：name 不等于：value"></option>
        <option value="变量：name 包含：value"></option>
        <option value="变量：name 大于：0"></option>
        <option value="变量：name 为空"></option>
      </datalist></form
  ></Teleport>
</template>

<style scoped src="./studio-workflow.css"></style>
