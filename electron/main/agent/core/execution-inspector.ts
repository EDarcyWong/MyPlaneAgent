import { randomUUID } from 'node:crypto'
import { validateToolArguments } from './execution-guards.js'
import type { InspectionCall, InspectionCommand, InspectionState } from '../../../shared/execution-inspector.js'

export class ExecutionInspector {
  private calls: InspectionCall[] = []
  private pauseRequested: boolean
  private pending?: { call: InspectionCall; draft?:string; resolve:(args:Record<string,unknown>)=>void; validate?:(args:Record<string,unknown>)=>void }
  constructor(private signal: AbortSignal, pause = false) { this.pauseRequested = pause }
  snapshot(): InspectionState { return structuredClone({pauseRequested:this.pauseRequested,checkpointId:this.pending?.call.id,draft:this.pending?.draft,calls:this.calls}) }
  finish(): InspectionState {
    for(const call of this.calls)if(['ready','running','paused'].includes(call.status)){call.status='error';call.output??='对话已结束，此调用未返回完成结果'}
    this.pauseRequested=false
    return {...this.snapshot(),finished:true,checkpointId:undefined}
  }
  command(command: Omit<InspectionCommand,'requestId'>) {
    if(command.action==='state')return this.snapshot()
    this.signal.throwIfAborted()
    if(command.action==='draft'){
      if(!this.pending||command.checkpointId!==this.pending.call.id)throw new Error('暂停点已变化')
      if(typeof command.draft!=='string'||command.draft.length>200000)throw new Error('入参草稿不能超过 200000 字符')
      this.pending.draft=command.draft;return this.snapshot()
    }
    if(command.action==='pause'){this.pauseRequested=true;return this.snapshot()}
    if(command.action!=='continue'&&command.action!=='step')throw new Error('不支持的检查器操作')
    const pending=this.pending
    if(pending){
      if(command.checkpointId!==pending.call.id)throw new Error('暂停点已变化，请刷新后重试')
      const args=structuredClone(command.args??pending.call.args)
      if(JSON.stringify(args).length>200000)throw new Error('入参不能超过 200000 字符')
      validateToolArguments(pending.call.schema,args)
      pending.validate?.(args)
      pending.call.args=args;pending.call.edited=JSON.stringify(args)!==JSON.stringify(pending.call.originalArgs)
      pending.call.status='ready';this.pauseRequested=command.action==='step'
      this.pending=undefined;pending.resolve(args)
    }else{
      if(command.checkpointId||command.args||command.action==='step')throw new Error('当前没有可修改的暂停点')
      this.pauseRequested=false
    }
    return this.snapshot()
  }
  async before(kind:InspectionCall['kind'],name:string,source:string,args:Record<string,unknown>,schema:object,id:string=randomUUID(),validate?:(args:Record<string,unknown>)=>void) {
    this.signal.throwIfAborted()
    if(this.pending)throw new Error('另一个调用仍在暂停，不能覆盖当前检查点')
    const call:InspectionCall={id,kind,name,source,args:structuredClone(args),originalArgs:structuredClone(args),schema:structuredClone(schema),status:this.pauseRequested?'paused':'ready'}
    this.calls.push(call);this.calls=this.calls.slice(-60)
    if(!this.pauseRequested)return args
    return new Promise<Record<string,unknown>>((resolve,reject)=>{
      const abort=()=>{if(this.pending?.call.id===id)this.pending=undefined;call.status='error';call.output='执行已停止';reject(this.signal.reason??new Error('执行已停止'))}
      this.pending={call,validate,resolve:value=>{this.signal.removeEventListener('abort',abort);resolve(value)}}
      this.signal.addEventListener('abort',abort,{once:true})
      if(this.signal.aborted)abort()
    })
  }
  update(id:string,status:InspectionCall['status'],output?:unknown){
    const call=this.calls.find(item=>item.id===id);if(!call)return
    call.status=status
    if(output!==undefined){let text:string;try{text=typeof output==='string'?output:JSON.stringify(output)}catch{text=String(output)}call.output=text.length>16000?text.slice(0,16000)+'\n[展示已截断]':text}
  }
  async run<I extends object,O>(name:string,input:I,schema:object,work:(input:I)=>Promise<O>,validate?:(input:I)=>void):Promise<O>{
    const id=randomUUID()
    const args=await this.before('ability',name,'能力模块',input as Record<string,unknown>,schema,id,validate?value=>validate(value as I):undefined)
    try{this.signal.throwIfAborted();validateToolArguments(schema,args);validate?.(args as I);this.update(id,'running');const result=await work(args as I);this.update(id,'complete',result);return result}
    catch(error){this.update(id,'error',String(error));throw error}
  }
}
