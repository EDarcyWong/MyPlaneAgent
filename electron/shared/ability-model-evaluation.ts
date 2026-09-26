import type { AbilityStageId } from './ability-catalog.js'
import type { TokenUsage } from './local-ai-usage.js'
export type ModelEvaluation = {
  id:string; createdAt:string; model:string; suiteHash:string; maxTokens:number
  mode?:'raw'|'paired'; contextLength?:number
  moduleVersions?:Array<{moduleId:string;versionId:string;hash:string}>
  status:'running'|'complete'|'cancelled'|'interrupted'; elapsedMs:number
  cases:Array<{id:string;stageId:AbilityStageId;name:string;passed:boolean;answer:string;expected:unknown;error?:string;elapsedMs:number;usage?:TokenUsage;arm?:'raw'|'assisted';trace?:Array<{moduleId:string;output:unknown}>}>
}
export type ModelEvaluationCommands = {
  abilityModelEvaluationRun:{input:undefined;output:ModelEvaluation}
  abilityModelComparisonRun:{input:undefined;output:ModelEvaluation}
  abilityModelEvaluationHistory:{input:undefined;output:ModelEvaluation[]}
  abilityModelEvaluationCancel:{input:undefined;output:void}
}
