import type { WorkflowRule, WorkflowNode } from './local-ai-workflow.js';

export const ruleOperators: Record<WorkflowRule['kind'], { value: string; label: string }[]> = {
  text: [{value:'eq',label:'等于'},{value:'ne',label:'不等于'},{value:'contains',label:'包含'},{value:'starts',label:'开头是'},{value:'ends',label:'结尾是'},{value:'empty',label:'为空'},{value:'notEmpty',label:'非空'}],
  number: [{value:'eq',label:'等于'},{value:'ne',label:'不等于'},{value:'gt',label:'大于'},{value:'gte',label:'大于等于'},{value:'lt',label:'小于'},{value:'lte',label:'小于等于'}],
  boolean: [{value:'eq',label:'等于'},{value:'ne',label:'不等于'}],
  collection: [{value:'empty',label:'为空'},{value:'notEmpty',label:'非空'},{value:'contains',label:'包含元素（JSON）'},{value:'hasKey',label:'包含对象字段'}],
};
export const isDecision = (type: string) => ['judge','predicate','switch'].includes(type);
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b,key) && sameJson(a[key],b[key]));
}
export function decisionValue(value: string, resolve: (expression: string) => unknown): unknown {
  const match = value.trim().match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (match) {
    const result = resolve(match[1]);
    if (result === undefined) throw new Error(`判断字段不存在：${match[1]}`);
    return result;
  }
  return value;
}
export function typedDecisionValue(value: unknown, kind: 'text'|'number'|'boolean'): string|number|boolean {
  if (kind === 'text') {
    if (typeof value !== 'string') throw new Error('文本判断需要字符串');
    return value;
  }
  if (kind === 'number') {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('数值判断需要有效数字');
    return Number(value);
  }
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('布尔判断只接受 true 或 false');
}
export function evaluateRule(rule: WorkflowRule, resolve: (expression: string) => unknown): boolean {
  const raw = decisionValue(rule.left, resolve), right = () => decisionValue(rule.right, resolve);
  if (rule.kind === 'collection') {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object') throw new Error('集合判断需要数组或对象');
    if (rule.operator === 'empty') return Object.keys(value).length === 0;
    if (rule.operator === 'notEmpty') return Object.keys(value).length > 0;
    if (rule.operator === 'hasKey') return !Array.isArray(value) && Object.hasOwn(value, String(right()));
    if (!Array.isArray(value)) throw new Error('包含元素判断需要数组');
    const target = right(), parsed = typeof target === 'string' ? JSON.parse(target) : target;
    return value.some(item => sameJson(item, parsed));
  }
  const left = typedDecisionValue(raw, rule.kind);
  if (rule.operator === 'empty') return left === '';
  if (rule.operator === 'notEmpty') return left !== '';
  const other = typedDecisionValue(right(), rule.kind);
  switch (rule.operator) {
    case 'eq': return left === other;
    case 'ne': return left !== other;
    case 'gt': return left > other;
    case 'gte': return left >= other;
    case 'lt': return left < other;
    case 'lte': return left <= other;
    case 'contains': return String(left).includes(String(other));
    case 'starts': return String(left).startsWith(String(other));
    case 'ends': return String(left).endsWith(String(other));
    default: throw new Error('不支持的判断运算符');
  }
}
export function validateDecision(node: Extract<WorkflowNode, {type:'judge'|'predicate'|'switch'}>) {
  const branches = node.branches || [];
  if (node.type === 'switch') {
    const c = node.config;
    if (!['text','number','boolean'].includes(c.kind) || typeof c.value !== 'string' || !c.value.trim()) throw new Error('请填写 Switch 判断值和数据类型');
    if (!Array.isArray(c.cases) || !c.cases.length || c.cases.length > 50 || branches.length !== c.cases.length + 1) throw new Error('Switch 需要 1–50 个匹配分支和一个默认分支');
    const ids = new Set([c.defaultBranchId]), values = new Set();
    for (const item of c.cases) {
      if (typeof item.value !== 'string') throw new Error('Switch 匹配值必须填写');
      const value = typedDecisionValue(item.value, c.kind);
      if (values.has(value) || ids.has(item.branchId)) throw new Error('Switch 匹配值和分支不能重复');
      values.add(value); ids.add(item.branchId);
    }
    if (ids.size !== branches.length || branches.some(branch => !ids.has(branch.id))) throw new Error('Switch 分支配置无效');
  } else {
    const c = node.config;
    if (!['all','any'].includes(c.mode) || !Array.isArray(c.rules) || !c.rules.length || c.rules.length > 50 || (node.type === 'judge' && c.rules.length !== 1)) throw new Error('请配置有效的判断规则（最多 50 条）');
    if (branches.length !== 2) throw new Error('判断组件必须保留成立和不成立两个分支');
    for (const rule of c.rules) {
      if (!ruleOperators[rule.kind]?.some(item => item.value === rule.operator) || typeof rule.left !== 'string' || !rule.left.trim() || typeof rule.right !== 'string') throw new Error('判断字段或运算符无效');
      if (!['empty','notEmpty'].includes(rule.operator) && !rule.right.includes('{{') && ['number','boolean'].includes(rule.kind)) typedDecisionValue(rule.right, rule.kind as 'number'|'boolean');
    }
  }
}
