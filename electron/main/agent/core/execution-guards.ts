import { Ajv } from 'ajv'
import type { AgentPlan } from '../../../shared/types/index.js'
const ajv = new Ajv({strict:false,allErrors:true})
export function validateToolArguments(schema: object, args: unknown): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须为对象')
  const validate = ajv.compile(schema)
  if (!validate(args)) throw new Error(`工具参数无效：${ajv.errorsText(validate.errors)}`)
}
export function validateExecutionPlan(plan: AgentPlan): void {
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length>1000) throw new Error('执行计划须包含 1–1000 个步骤')
  for (const [index,step] of plan.steps.entries()) {
    if (!step || typeof step.capability!=='string' || !step.capability || !step.args || typeof step.args!=='object' || Array.isArray(step.args)) throw new Error('执行步骤格式无效')
    if (step.dependsOn && (!Array.isArray(step.dependsOn)||new Set(step.dependsOn).size!==step.dependsOn.length||step.dependsOn.some(dep=>!Number.isSafeInteger(dep)||dep<0||dep>=index))) throw new Error('执行依赖必须指向已排在前面的步骤，不可重复或形成循环')
  }
}
