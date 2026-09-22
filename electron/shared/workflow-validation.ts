export class WorkflowValidationError extends Error {
  constructor(message: string, public readonly nodeIds: string[]) {
    super(message);
  }
}

// Electron serializes thrown errors as messages, so preserve node IDs explicitly.
const marker = " [workflow-nodes:";
export function workflowValidationMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof WorkflowValidationError
    ? `${message}${marker}${JSON.stringify(error.nodeIds)}]`
    : message;
}

export function readWorkflowValidationError(error: unknown) {
  const message = String(error).replace(/^Error: /, "");
  const start = message.lastIndexOf(marker);
  if (start >= 0 && message.endsWith("]")) {
    try {
      const ids: unknown = JSON.parse(message.slice(start + marker.length, -1));
      if (Array.isArray(ids) && ids.every(id => typeof id === "string"))
        return { message: message.slice(0, start), nodeIds: ids as string[] };
    } catch { /* Ordinary errors need no node highlighting. */ }
  }
  return { message, nodeIds: [] as string[] };
}
