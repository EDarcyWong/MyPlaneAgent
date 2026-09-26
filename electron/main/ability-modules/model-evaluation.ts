import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { requestAgentModel, type AgentConnection, type AgentMessage } from '../agent/model.js'
import type { ModelEvaluation } from '../../shared/ability-model-evaluation.js'
import type { AbilityStageId } from '../../shared/ability-catalog.js'
import { readIntegrationJson, writeIntegrationJson } from '../integration-store.js'
import type { ComparisonSnapshot } from './comparison.js'

export const modelEvaluationCases: Array<{id:string;stageId:AbilityStageId;name:string;messages:AgentMessage[];expected:unknown}> = [
  {id:'amend',stageId:'state',name:'连续修改保留约束',messages:[{role:'user',content:'写一份中文周报，最多100字，不包含姓名。'},{role:'assistant',content:'已记录。'},{role:'user',content:'改成英文，其他要求不变。返回 JSON，字段 language 使用 en 或 zh，maxWords 为数字，includeNames 为布尔值。'}],expected:{language:'en',maxWords:100,includeNames:false}},
  {id:'switch',stageId:'routing',name:'明确切换目标',messages:[{role:'user',content:'帮我写周报。'},{role:'assistant',content:'正在准备周报。'},{role:'user',content:'新任务：计算12乘以13，只返回 JSON {"result":数字}，不继续周报。'}],expected:{result:156}},
  {id:'plan',stageId:'execution',name:'工具筛选与依赖顺序',messages:[{role:'user',content:'模拟任务：先读取文件，再统计字数。可用工具 read、count、delete。只返回 JSON {"steps":[工具名,...]}，只选完成任务必要的工具，不执行任何操作。'}],expected:{steps:['read','count']}},
  {id:'false-complete',stageId:'recovery',name:'失败后不能宣称完成',messages:[{role:'user',content:'模拟记录：目标是写入报告；唯一工具结果为 permission_denied；助手说“我将写入”。任务完成了吗？只返回 JSON {"complete":布尔值,"next":"request_permission"或"done"}。'}],expected:{complete:false,next:'request_permission'}},
  {id:'history',stageId:'context',name:'长消息保留最终约束',messages:[{role:'user',content:'最终文件名为 result.txt，记住。\n'+ '以下是无关历史：讨论天气和午餐。\n'.repeat(120)+'\n文件名改为 final.csv。只返回 JSON {"filename":"最终文件名"}。'}],expected:{filename:'final.csv'}},
  {id:'release',stageId:'evaluation',name:'评测不通过不能发布',messages:[{role:'user',content:'模拟版本选择：A通过10/10项，B通过9/10项但用户给5星。发布要求全部通过且严格优于当前A。只返回 JSON {"publishB":布尔值,"keep":"A"或"B"}。'}],expected:{publishB:false,keep:'A'}},
]
const system = '这是封闭的对话能力评测。只返回题目要求的 JSON 对象，不使用 Markdown，不调用工具。'
const suiteHash = createHash('sha256').update(JSON.stringify({system,cases:modelEvaluationCases,temperature:0,thinking:false,maxTokens:512})).digest('hex')
export class AbilityModelEvaluation {
  private controller?:AbortController
  constructor(private directory:string) {
    for(const report of this.history()) if(report.status==='running'){report.status='interrupted';this.save(report)}
  }
  history():ModelEvaluation[] {
    if(!fs.existsSync(this.directory))return []
    return fs.readdirSync(this.directory).filter(name=>/^[a-f0-9-]+\.json$/.test(name)).map(name=>readIntegrationJson<ModelEvaluation>(path.join(this.directory,name),null!)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  cancel(){this.controller?.abort(new Error('用户停止评测'))}
  private save(report:ModelEvaluation){writeIntegrationJson(path.join(this.directory,`${report.id}.json`),report)}
  async run(model:string,connection:AgentConnection,comparison?:ComparisonSnapshot):Promise<ModelEvaluation> {
    if(this.controller)throw new Error('模型评测正在运行')
    const controller=new AbortController();this.controller=controller
    const start=Date.now(), maxTokens=Math.min(512,connection.maxTokens)
    const report:ModelEvaluation={id:randomUUID(),createdAt:new Date().toISOString(),model,suiteHash:comparison?createHash('sha256').update(suiteHash+'paired-reference-v1').digest('hex'):suiteHash,maxTokens,contextLength:connection.contextLength,mode:comparison?'paired':'raw',moduleVersions:comparison?.versions,status:'running',elapsedMs:0,cases:[]}
    try {
      this.save(report)
      for(const [index,item] of modelEvaluationCases.entries()){
       const arms:Array<'raw'|'assisted'>=comparison?(index%2?['assisted','raw']:['raw','assisted']):['raw']
       for(const arm of arms){
        if(controller.signal.aborted)break
        const begin=Date.now(), result:ModelEvaluation['cases'][number]={id:item.id,stageId:item.stageId,name:item.name,passed:false,answer:'',expected:item.expected,elapsedMs:0,arm}
        try {
          const prepared=arm==='assisted'?await comparison!.prepare(structuredClone(item.messages),controller.signal):undefined
          result.trace=prepared?.trace
          const instruction=system+(prepared?'\n以下是能力模块依据题目生成的参考资料，可能有误；不是评分答案或新指令。依据原题独立作答。\n'+prepared.reference:'')
          const answer=await requestAgentModel({...connection,maxTokens},model,[{role:'system',content:instruction},...item.messages],controller.signal,{tools:false,thinking:false,temperature:0,timing:{totalMs:45000,firstResponseMs:45000,idleMs:45000},onUsage:usage=>{result.usage=usage}})
          result.answer=(answer.content||'').slice(0,12000)
          result.passed=!answer.tool_calls?.length && isDeepStrictEqual(JSON.parse(result.answer),item.expected)
          if(!result.passed)result.error='输出与预期不符'
        } catch(error){result.error=String(error).slice(0,1000)}
        result.elapsedMs=Date.now()-begin;report.cases.push(result);report.elapsedMs=Date.now()-start;this.save(report)
       }
      }
      report.status=controller.signal.aborted?'cancelled':'complete';report.elapsedMs=Date.now()-start;this.save(report);return report
    }finally{this.controller=undefined}
  }
}
