import type { WorkflowBranch, WorkflowVariableAssignment } from './local-ai-workflow.js'

type InputSource = {
  id: string
  name?: string
  type: string
  branches?: WorkflowBranch[]
  assignments?: WorkflowVariableAssignment[]
}

export function connectedOutputBranches(source: InputSource, nodeId: string) {
  return (source.branches || []).filter(branch =>
    (branch.targetNodeIds || (branch.targetNodeId ? [branch.targetNodeId] : [])).includes(nodeId),
  )
}

export function workflowOutputData(value?: string, fallback: Record<string, unknown> = {}): unknown {
  if (value === undefined || !value.trim()) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function workflowInputPreview(nodes: InputSource[], nodeId: string) {
  return nodes.flatMap(source => {
    const fallback: Record<string, unknown> = {}
    if (source.type === 'data')
      for (const assignment of source.assignments || []) {
        const name = assignment.name.trim()
        if (name) fallback[name] = ''
      }
    // Each connected branch describes one possible input. Never merge alternative shapes.
    return connectedOutputBranches(source, nodeId).map(branch => ({
      sourceId: source.id,
      sourceName: source.name || source.id,
      branchId: branch.id,
      branchName: branch.name,
      value: workflowOutputData(branch.outputValue, fallback),
    }))
  })
}
