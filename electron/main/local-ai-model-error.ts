// A length finish discards the entire generation, including apparently complete calls.
export class ModelOutputLimitError extends Error {
 constructor(public readonly maxTokens:number, public readonly output?:{text:number;reasoning:number;arguments:number;calls:number}){
  super(`模型输出达到本轮 ${maxTokens} Token 上限而被截断，本轮工具未执行。进度已保留，可缩小任务后继续；也可在设置的“工作区默认值”中调整最大输出 Tokens，并确认模型上下文容量足够。`)
  this.name='ModelOutputLimitError'
 }
}

export type ModelResponseBreakdown={text:number;reasoning:number;arguments:number;calls:number}

// The model response is discarded before any returned tool call is executed.
// Callers may retry a smaller step without replaying completed operations.
export class ModelResponseSizeError extends Error {
 constructor(
  public readonly kind:'wire'|'characters',
  public readonly limit:number,
  public readonly observed:number,
  public readonly output:ModelResponseBreakdown
 ){
  super(`模型响应${kind==='wire'?'流':'内容'}超过本轮容量（${observed}/${limit} ${kind==='wire'?'字节':'字符'}），本轮工具未执行。已完成进度仍保留，可缩小单步输出后继续。`)
  this.name='ModelResponseSizeError'
 }
}
