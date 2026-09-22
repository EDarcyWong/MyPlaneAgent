import { parseWorkflowJson, renderWorkflowJsonTemplate } from './workflow-json-template.js'

export function parseWorkflowAiOutput(value?: string): unknown {
  if (!value?.trim()) throw new Error('请填写输出内容（JSON）')
  return parseWorkflowJson(value)
}

// Only empty string values are generated. Fixed values and references are assembled locally.
function generatedFields(value: unknown): unknown {
  if (value === '') return ''
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value).flatMap(([key, child]) => {
    const projected = generatedFields(child)
    return projected === undefined ? [] : [[key, projected]]
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}
export function workflowAiGeneratedTemplate(template: unknown): Record<string, unknown> {
  const fields = generatedFields(template)
  return fields === '' ? { $value: '' } : (fields || {}) as Record<string, unknown>
}

export function assembleWorkflowAiOutput(
  template: unknown,
  generated: Record<string, unknown>,
  resolve: (expression: string) => unknown,
): unknown {
  const visit = (value: unknown, output: unknown): unknown => {
    if (value === '') return output
    if (Array.isArray(value)) return value.map((child,index)=>visit(child,(output as Record<string,unknown> | undefined)?.[index]))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,visit(child,(output as Record<string,unknown> | undefined)?.[key])]))
    return JSON.parse(renderWorkflowJsonTemplate(JSON.stringify(value),resolve,false))
  }
  return visit(template, template === '' ? generated.$value : generated)
}
