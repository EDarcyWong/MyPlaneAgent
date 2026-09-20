export type ContextCheckpoint={summary:string;through:number;updatedAt:string;compactions:number}
export type ContextStatus={inputTokens:number;capacity:number;reservedOutput:number;estimated:true;state:'ready'|'compacting'|'error';compactions:number;message?:string}
