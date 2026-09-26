// Restrict generated arguments, not the underlying tool or its permissions.
export function recoveryToolSchema(value: unknown): any {
  if (Array.isArray(value)) return value.map(recoveryToolSchema)
  if (!value || typeof value !== 'object') return value
  const result:Record<string,any> = Object.fromEntries(Object.entries(value).map(([key,item])=>[key,recoveryToolSchema(item)]))
  if (result.type === 'string' && (result.minLength || 0) <= 2048) result.maxLength = Math.min(result.maxLength ?? Infinity,2048)
  if (result.type === 'array' && (result.minItems || 0) <= 2) result.maxItems = Math.min(result.maxItems ?? Infinity,2)
  return result
}
