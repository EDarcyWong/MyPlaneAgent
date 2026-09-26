export type ModelOutputSnapshot={text:string;reasoning:number;arguments:number;calls:number}

// A truncated tool call is never executable. Plain text may be retained by the
// chat runner and continued in a tool-free response segment.
export class ModelOutputLimitError extends Error {
 constructor(public readonly maxTokens:number,public readonly output?:ModelOutputSnapshot){
  super(`模型输出达到本轮 ${maxTokens} Token 上限而被截断，本轮工具未执行。进度已保留；纯文本回答可由长响应能力继续生成，截断的工具调用必须重新生成完整调用。`)
  this.name='ModelOutputLimitError'
 }
}
