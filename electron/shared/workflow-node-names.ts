import type { WorkflowNode } from './local-ai-workflow.js'

type NamedNode = Pick<WorkflowNode, 'id' | 'name' | 'type'>

export function nextWorkflowNodeName(nodes: NamedNode[], type: WorkflowNode['type'], baseName: string): string {
  let maximum = 0n
  for (const node of nodes) {
    if (node.type !== type) continue
    const suffix = node.name.trim().match(/(\d+)$/)
    if (suffix) {
      const number = BigInt(suffix[1])
      if (number > maximum) maximum = number
    }
  }
  const names = new Set(nodes.map(node => node.name.trim()))
  let next = maximum + 1n
  while (names.has(`${baseName} ${next}`)) next++
  return `${baseName} ${next}`
}

export function workflowNodeNameError(node: NamedNode, nodes: NamedNode[]): string {
  const name = node.name.trim()
  if (!name) return '请填写节点名称'
  if (name.length > 100) return '节点名称不能超过 100 个字符'
  if (nodes.some(other => other.id !== node.id && other.name.trim() === name))
    return `节点名称“${name}”已存在，同一工作流中的组件名称必须唯一`
  return ''
}
