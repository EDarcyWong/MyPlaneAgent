type VariableNode = {id:string;name:string;type:string};
export function variableReference(expression: string, nodes: VariableNode[]) {
  const matches = nodes.filter(node => node.type === 'data' && expression.startsWith(`${node.name.trim()}.`))
    .sort((a,b) => b.name.trim().length - a.name.trim().length);
  const node = matches[0];
  return node ? {nodeId:node.id,key:expression.slice(node.name.trim().length+1)} : undefined;
}

// Persist IDs while keeping readable names in every editor template.
export function mapVariableReferences<T>(value: T, nodes: VariableNode[], mode: 'store'|'display'): T {
  const text = (value: string) => value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, raw: string) => {
    const expression = raw.trim();
    if (mode === 'store') {
      const ref = variableReference(expression,nodes);
      return ref ? `{{nodeVariables.${ref.nodeId}.${ref.key}}}` : whole;
    }
    const match = expression.match(/^nodeVariables\.([^.]+)\.(.+)$/);
    const node = match && nodes.find(node=>node.id === match[1] && node.type === 'data');
    return node ? `{{${node.name.trim()}.${match![2]}}}` : whole;
  });
  const walk = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      if (['outputValue','resultJson','endResult'].includes(key)) {
        // Rewrite decoded JSON strings without changing indentation or escaping.
        try {
          JSON.parse(value);
          return value.replace(/"(?:\\[\s\S]|[^"\\])*"/g, token => {
            const original = JSON.parse(token) as string, updated = text(original);
            return original === updated ? token : JSON.stringify(updated);
          });
        } catch { return text(value); }
      }
      return text(value);
    }
    if (Array.isArray(value)) return value.map(item=>walk(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,walk(item,key)]));
    return value;
  };
  return walk(value) as T;
}
