export function parseWorkflowJson(source: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('输出值必须是有效 JSON，引用表达式需放在双引号内')
  }

  // JSON.parse silently overwrites duplicate keys. Reject them before using the template.
  const scopes: { keys?: Set<string>; expectsKey: boolean }[] = []
  for (const token of source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) || []) {
    const scope = scopes.at(-1)
    if (token === '{') scopes.push({ keys: new Set(), expectsKey: true })
    else if (token === '[') scopes.push({ expectsKey: false })
    else if (token === '}' || token === ']') scopes.pop()
    else if (token === ',' && scope?.keys) scope.expectsKey = true
    else if (token.startsWith('"') && scope?.keys && scope.expectsKey) {
      const key = JSON.parse(token) as string
      if (scope.keys.has(key)) throw new Error(`输出模板包含重复字段“${key}”`)
      scope.keys.add(key)
      scope.expectsKey = false
    }
  }
  return parsed
}

export function parseWorkflowJsonTemplate(value?: string): Record<string, unknown> {
  const parsed = parseWorkflowJson(value?.trim() || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('输出模板必须是 JSON 对象')
  return parsed as Record<string, unknown>
}

export function workflowJsonError(value?: string): string {
  if (!value?.trim()) return ''
  try {
    parseWorkflowJson(value)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function formatWorkflowJson(value: string): string {
  return JSON.stringify(parseWorkflowJson(value), null, 2)
}

export function workflowJsonTemplateError(value?: string): string {
  try {
    parseWorkflowJsonTemplate(value)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function renderWorkflowJsonTemplate(
  value: string | undefined,
  resolve: (expression: string) => unknown,
  objectOnly = true,
): string {
  const reference = (expression: string) => {
    const result = resolve(expression.trim())
    if (result === undefined)
      throw new Error(`输出模板引用“${expression.trim()}”的数据不存在或来源不唯一`)
    return result
  }
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      const exact = item.match(/^\{\{\s*([^{}]+?)\s*\}\}$/)
      if (exact) return reference(exact[1])
      return item.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expression: string) => {
        const result = reference(expression)
        return typeof result === 'object' ? JSON.stringify(result) : String(result)
      })
    }
    if (Array.isArray(item)) return item.map(visit)
    if (item && typeof item === 'object')
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]))
    return item
  }
  return JSON.stringify(visit(objectOnly ? parseWorkflowJsonTemplate(value) : parseWorkflowJson(value || '{}')))
}
