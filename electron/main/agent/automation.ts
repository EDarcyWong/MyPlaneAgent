import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {readIntegrationJson,writeIntegrationJson} from '../integration-store.js'
import type {AgentTask} from '../../shared/local-ai-agent.js'
import type {AutomationRun,AutomationTask,AutomationTaskInput,AutomationTemplate,AutomationTrigger} from '../../shared/local-ai-automation.js'
import {LocalAgentService} from './service.js'

const now=()=>new Date().toISOString()
const minute=60_000
const text=(value:unknown,label:string,maximum:number)=>{const result=String(value??'').trim();if(!result||result.length>maximum)throw new Error(`${label}需要 1–${maximum} 个字符`);return result}
const integer=(value:unknown,label:string,minimum:number,maximum:number)=>{const result=Number(value);if(!Number.isInteger(result)||result<minimum||result>maximum)throw new Error(`${label}需要 ${minimum}–${maximum} 的整数`);return result}
const validTimezone=(value:string)=>{try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return value}catch{throw new Error('时区无效')}}
const wallParts=(date:Date,timezone:string)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]))
const timeParts=(value:string)=>{const match=value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);if(!match)throw new Error('时间格式需要 HH:mm');return {hour:Number(match[1]),minute:Number(match[2])}}
const weekdayNumber=(value:string)=>({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[value]??-1)

const cronField=(raw:string,minimum:number,maximum:number)=>{
 const values=new Set<number>()
 for(const part of raw.split(',')){
  const [rangeRaw,stepRaw]=part.split('/'),step=stepRaw===undefined?1:integer(stepRaw,'Cron 步长',1,maximum-minimum+1)
  const [start,end]=rangeRaw==='*'?[minimum,maximum]:rangeRaw.includes('-')?rangeRaw.split('-').map(Number):[Number(rangeRaw),Number(rangeRaw)]
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<minimum||end>maximum||start>end)throw new Error('Cron 表达式字段超出范围')
  for(let value=start;value<=end;value+=step)values.add(value)
 }
 return values
}
const parseCron=(expression:string)=>{const fields=expression.trim().split(/\s+/);if(fields.length!==5)throw new Error('Cron 需要 5 个字段：分 时 日 月 星期');return {minute:cronField(fields[0],0,59),hour:cronField(fields[1],0,23),day:cronField(fields[2],1,31),month:cronField(fields[3],1,12),weekday:cronField(fields[4],0,6)}}
const matchesCron=(date:Date,timezone:string,expression:string)=>{const parts=wallParts(date,timezone),cron=parseCron(expression);return cron.minute.has(Number(parts.minute))&&cron.hour.has(Number(parts.hour))&&cron.day.has(Number(parts.day))&&cron.month.has(Number(parts.month))&&cron.weekday.has(weekdayNumber(parts.weekday))}

export function nextAutomationRun(trigger:AutomationTrigger,timezone:string,after=new Date()):string|undefined{
 validTimezone(timezone)
 if(trigger.type==='once'){const at=new Date(trigger.at);if(Number.isNaN(at.getTime()))throw new Error('一次性执行时间无效');return at.getTime()>after.getTime()?at.toISOString():undefined}
 if(trigger.type==='interval')return new Date(after.getTime()+integer(trigger.minutes,'间隔分钟',1,525600)*minute).toISOString()
 if(trigger.type==='daily')timeParts(trigger.time)
 if(trigger.type==='weekly'){timeParts(trigger.time);if(!Array.isArray(trigger.weekdays)||!trigger.weekdays.length||trigger.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6))throw new Error('每周任务需要选择星期')}
 if(trigger.type==='cron')parseCron(text(trigger.expression,'Cron 表达式',120))
 let cursor=new Date(Math.floor(after.getTime()/minute)*minute+minute),remaining=trigger.type==='cron'?527040:11520
 while(remaining--){const parts=wallParts(cursor,timezone),clock=`${parts.hour}:${parts.minute}`,weekday=weekdayNumber(parts.weekday),matched=trigger.type==='daily'?clock===trigger.time:trigger.type==='weekly'?clock===trigger.time&&trigger.weekdays.includes(weekday):matchesCron(cursor,timezone,trigger.expression);if(matched)return cursor.toISOString();cursor=new Date(cursor.getTime()+minute)}
 throw new Error('无法在允许范围内计算下一次执行时间')
}

const templates:AutomationTemplate[]=[
 {id:'project.daily-review',name:'每日项目检查',description:'读取项目状态、待办和近期变化，输出下一步建议。',instruction:'检查当前项目状态、近期变化、测试与待办，给出有证据的风险和下一步建议。不要修改文件。',mode:'coding',approvalMode:'ask',parameterSchema:{type:'object',properties:{focus:{type:'string',title:'关注范围'}}}},
 {id:'web.monitor',name:'网页信息监控',description:'定期搜索并核对公开网页的变化。',instruction:'联网搜索并核对与任务主题相关的最新公开信息，只报告有来源支持的重要变化。',mode:'general',approvalMode:'ask',parameterSchema:{type:'object',properties:{topic:{type:'string',title:'监控主题'}}}},
 {id:'project.maintenance',name:'项目维护',description:'在沙盒保护下执行检查、修复和验证。',instruction:'检查项目中可确认的问题，进行必要的小范围修复并运行相关验证。',mode:'coding',approvalMode:'full',parameterSchema:{type:'object',properties:{scope:{type:'string',title:'维护范围'}}}}
]

export class AutomationService {
 private readonly tasksFile:string
 private readonly runsFile:string
 private timer?:ReturnType<typeof setInterval>
 private ticking=false
 private readonly timeouts=new Map<string,ReturnType<typeof setTimeout>>()
 constructor(directory:string,private agent:LocalAgentService,private log?:(level:'info'|'warn'|'error',message:string)=>void,private notify?:(title:string,body:string)=>void,private workflows?:{exists:(id:string,projectId:string)=>boolean;start:(id:string,onUpdate:(run:{id:string;status:string;agentTaskIds:string[];summary?:string;error?:string})=>void)=>{id:string};cancel:(id:string)=>void}){this.tasksFile=path.join(directory,'tasks.json');this.runsFile=path.join(directory,'runs.json');this.recover();this.timer=setInterval(()=>this.scheduleTick(),15_000);this.timer.unref?.();this.scheduleTick()}
 private scheduleTick(){void this.tick().catch(error=>this.log?.('error','定时调度检查失败；'+String(error)))}
 templates(){return structuredClone(templates)}
 tasks(){const rows=readIntegrationJson<AutomationTask[]>(this.tasksFile,[]);if(!Array.isArray(rows))throw new Error('定时任务记录已损坏');return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
 runs(taskId?:string,limit=100){const rows=readIntegrationJson<AutomationRun[]>(this.runsFile,[]);if(!Array.isArray(rows))throw new Error('定时任务运行记录已损坏');return rows.filter(row=>!taskId||row.taskId===taskId).sort((a,b)=>b.scheduledAt.localeCompare(a.scheduledAt)).slice(0,Math.max(1,Math.min(2000,limit)))}
 private writeTasks(rows:AutomationTask[]){writeIntegrationJson(this.tasksFile,rows)}
 private writeRuns(rows:AutomationRun[]){writeIntegrationJson(this.runsFile,[...rows].sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)).slice(-2000))}
 private validate(input:AutomationTaskInput,previous?:AutomationTask):AutomationTask{
  const project=this.agent.projects().find(item=>item.id===input.projectId);if(!project)throw new Error('请选择有效项目')
  const timezone=validTimezone(text(input.timezone,'时区',100)),trigger=structuredClone(input.trigger);nextAutomationRun(trigger,timezone,new Date(Date.now()-minute))
  const workflowId=input.workflowId?text(input.workflowId,'工作流 ID',120):undefined;if(workflowId&&!this.workflows?.exists(workflowId,project.id))throw new Error('请选择与当前项目匹配的有效工作流')
  if(!workflowId&&(!['general','coding','documents'].includes(input.agent?.mode)||!['ask','auto','full','unrestricted'].includes(input.agent?.approvalMode)))throw new Error('Agent 执行配置无效')
  const agentMode=['general','coding','documents'].includes(input.agent?.mode)?input.agent.mode:'general',approvalMode=['ask','auto','full','unrestricted'].includes(input.agent?.approvalMode)?input.agent.approvalMode:'ask'
  const createdAt=previous?.createdAt||now(),updatedAt=now(),task:AutomationTask={id:previous?.id||randomUUID(),name:text(input.name,'任务名称',100),enabled:input.enabled!==false,projectId:project.id,instruction:workflowId?String(input.instruction||'工作流触发').slice(0,16000):text(input.instruction,'任务要求',16000),trigger,timezone,agent:{model:workflowId?String(input.agent?.model||'workflow').slice(0,500):text(input.agent.model,'模型',500),mode:agentMode,maxSteps:workflowId?Math.max(1,Number(input.agent?.maxSteps)||1):integer(input.agent.maxSteps,'最大步骤',1,500),fastMode:input.agent?.fastMode!==false,approvalMode},execution:{timeoutMinutes:integer(input.execution?.timeoutMinutes,'超时分钟',1,1440),retryMax:integer(input.execution?.retryMax,'重试次数',0,10),retryDelayMinutes:integer(input.execution?.retryDelayMinutes,'重试间隔',1,1440),concurrency:'forbid'},output:{notifyOn:['always','failure','never'].includes(input.output?.notifyOn)?input.output.notifyOn:'failure'},...(workflowId?{workflowId}:{}),...(input.templateId?{templateId:text(input.templateId,'模板 ID',120)}:{}),...(input.templateParameters?{templateParameters:structuredClone(input.templateParameters)}:{}),state:previous?.state||{},createdAt,updatedAt}
  task.state.nextRunAt=task.enabled?nextAutomationRun(task.trigger,task.timezone,new Date()):undefined
  if(task.enabled&&task.trigger.type==='once'&&!task.state.nextRunAt)throw new Error('一次性任务的执行时间必须晚于当前时间')
  return task
 }
 save(input:AutomationTaskInput){const rows=this.tasks(),previous=input.id?rows.find(item=>item.id===input.id):undefined;if(input.id&&!previous)throw new Error('定时任务不存在');const task=this.validate(input,previous),next=previous?rows.map(item=>item.id===task.id?task:item):[task,...rows];this.writeTasks(next);return task}
 delete(id:string){const rows=this.tasks();if(!rows.some(item=>item.id===id))throw new Error('定时任务不存在');if(this.runs(id).some(run=>['queued','running','retry-wait'].includes(run.status)))throw new Error('任务正在执行或等待重试，不能删除');this.writeTasks(rows.filter(item=>item.id!==id));this.writeRuns(this.runs(undefined,2000).filter(run=>run.taskId!==id))}
 action(id:string,action:'enable'|'pause'|'run'){
  const rows=this.tasks(),task=rows.find(item=>item.id===id);if(!task)throw new Error('定时任务不存在')
  if(action==='run'){void this.launch(task,new Date().toISOString(),undefined,true);return task}
  task.enabled=action==='enable';task.updatedAt=now();task.state.nextRunAt=task.enabled?nextAutomationRun(task.trigger,task.timezone,new Date()):undefined;if(task.enabled&&task.trigger.type==='once'&&!task.state.nextRunAt)throw new Error('一次性任务的执行时间已过，请编辑执行时间');this.writeTasks(rows);return task
 }
 private recover(){const rows=this.runs(undefined,2000);let changed=false;for(const run of rows)if(['queued','running'].includes(run.status)){run.status='failed';run.finishedAt=now();run.error='应用在执行期间关闭，结果未确认；不会自动重放本次运行。';changed=true}if(changed)this.writeRuns(rows)}
 private async tick(){if(this.ticking)return;this.ticking=true;try{const current=Date.now();for(const run of this.runs(undefined,2000).filter(run=>run.status==='retry-wait'&&Date.parse(run.nextRetryAt||'')<=current)){const task=this.tasks().find(item=>item.id===run.taskId);if(task)await this.launch(task,run.scheduledAt,run)}for(const task of this.tasks().filter(task=>task.enabled&&task.state.nextRunAt&&Date.parse(task.state.nextRunAt)<=current))await this.launch(task,task.state.nextRunAt!)}finally{this.ticking=false}}
 private async launch(task:AutomationTask,scheduledAt:string,retryRun?:AutomationRun,manual=false){
  let tasks=this.tasks(),stored=tasks.find(item=>item.id===task.id);if(!stored)return
  const active=this.runs(task.id,500).some(run=>run.id!==retryRun?.id&&['queued','running','retry-wait'].includes(run.status));if(active){if(!retryRun){const skipped:AutomationRun={id:randomUUID(),taskId:task.id,taskName:task.name,status:'skipped',scheduledAt,finishedAt:now(),agentTaskIds:[],retryCount:0,error:'上一次运行尚未结束，并发策略 forbid 已跳过本次执行'};this.writeRuns([...this.runs(undefined,2000),skipped])}if(!manual)stored.state.nextRunAt=stored.enabled?nextAutomationRun(stored.trigger,stored.timezone,new Date()):undefined;this.writeTasks(tasks);return}
  const run:AutomationRun=retryRun||{id:randomUUID(),taskId:task.id,taskName:task.name,status:'queued',scheduledAt,agentTaskIds:[],retryCount:0};let runs=this.runs(undefined,2000);if(!retryRun)runs.push(run);run.status='running';run.startedAt=now();delete run.nextRetryAt;delete run.finishedAt;delete run.error;this.writeRuns(runs)
  if(!retryRun){stored.state.lastRunAt=run.startedAt;stored.state.lastRunId=run.id;stored.state.lastStatus='running';if(!manual){stored.state.nextRunAt=stored.trigger.type==='once'?undefined:nextAutomationRun(stored.trigger,stored.timezone,new Date());if(stored.trigger.type==='once')stored.enabled=false}this.writeTasks(tasks)}
  try{
   if(task.workflowId){if(!this.workflows?.exists(task.workflowId,task.projectId))throw new Error('工作流已停用、删除或不再属于此项目');const workflow=this.workflows.start(task.workflowId,workflowRun=>{const rows=this.runs(undefined,2000),current=rows.find(item=>item.id===run.id);if(!current)return;current.agentTaskIds=[...workflowRun.agentTaskIds];this.writeRuns(rows);if(workflowRun.status==='succeeded')this.finish(run.id,task,'succeeded',undefined,workflowRun.summary);else if(['failed','cancelled'].includes(workflowRun.status))this.finish(run.id,task,'failed',workflowRun.error||'工作流执行失败',workflowRun.summary)});run.workflowRunId=workflow.id;this.writeRuns(runs);return}
   const parameters=task.templateParameters&&Object.keys(task.templateParameters).length?`\n\n任务参数：\n${JSON.stringify(task.templateParameters,null,2)}`:''
   const result=this.agent.start({projectId:task.projectId,mode:task.agent.mode,model:task.agent.model,prompt:task.instruction+parameters,maxSteps:task.agent.maxSteps,fastMode:task.agent.fastMode,approvalMode:task.agent.approvalMode},0,agentTask=>this.updateRun(run.id,task,agentTask));run.agentTaskId=result.id;run.agentTaskIds.push(result.id);this.writeRuns(runs)
   const timeout=setTimeout(()=>{try{this.agent.stop(result.id,0)}catch{}this.finish(run.id,task,'failed','定时任务超过 '+task.execution.timeoutMinutes+' 分钟，已停止')},task.execution.timeoutMinutes*minute);timeout.unref?.();this.timeouts.set(run.id,timeout)
  }catch(error){this.finish(run.id,task,'failed',String(error))}
 }
 private updateRun(runId:string,task:AutomationTask,agentTask:AgentTask){if(['running','waiting'].includes(agentTask.status))return;const summary=[...agentTask.events].reverse().find(event=>event.kind==='assistant'&&event.text&&!event.text.startsWith('本次模型未调用工具'))?.text.slice(0,2000);this.finish(runId,task,agentTask.status==='completed'?'succeeded':'failed',agentTask.error||undefined,summary)}
 private finish(runId:string,task:AutomationTask,status:'succeeded'|'failed',error?:string,summary?:string){const timeout=this.timeouts.get(runId);if(timeout)clearTimeout(timeout);this.timeouts.delete(runId);const runs=this.runs(undefined,2000),run=runs.find(item=>item.id===runId);if(!run||!['running','queued'].includes(run.status))return
  if(status==='failed'&&run.retryCount<task.execution.retryMax){run.retryCount++;run.status='retry-wait';run.error=error;run.nextRetryAt=new Date(Date.now()+task.execution.retryDelayMinutes*minute).toISOString()}else{run.status=status;run.error=error;run.summary=summary;run.finishedAt=now()}this.writeRuns(runs)
  const tasks=this.tasks(),stored=tasks.find(item=>item.id===task.id);if(stored){stored.state.lastStatus=run.status;stored.state.lastRunId=run.id;stored.state.lastRunAt=run.startedAt;this.writeTasks(tasks)}
  this.log?.(status==='succeeded'?'info':'warn',`定时任务“${task.name}”${run.status==='retry-wait'?'等待重试':status==='succeeded'?'执行成功':'执行失败'}${error?'；'+error:''}`)
  if(run.status!=='retry-wait'&&(task.output.notifyOn==='always'||task.output.notifyOn==='failure'&&status==='failed'))this.notify?.(`定时任务：${task.name}`,(status==='succeeded'?(summary||'执行完成'):(error||'执行失败')).slice(0,180))
 }
 dispose(){if(this.timer)clearInterval(this.timer);for(const timeout of this.timeouts.values())clearTimeout(timeout);this.timeouts.clear()}
}
