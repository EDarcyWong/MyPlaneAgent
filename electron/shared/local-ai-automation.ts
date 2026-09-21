import type {AgentApprovalMode,AgentMode} from './local-ai-agent.js'

export type AutomationTrigger=
 | {type:'once';at:string}
 | {type:'interval';minutes:number}
 | {type:'daily';time:string}
 | {type:'weekly';time:string;weekdays:number[]}
 | {type:'cron';expression:string}

export type AutomationTask={
 id:string;name:string;enabled:boolean;projectId:string;instruction:string;trigger:AutomationTrigger;timezone:string
 agent:{model:string;mode:Exclude<AgentMode,'chat'>;maxSteps:number;fastMode:boolean;approvalMode:AgentApprovalMode}
 execution:{timeoutMinutes:number;retryMax:number;retryDelayMinutes:number;concurrency:'forbid'}
 output:{notifyOn:'always'|'failure'|'never'}
 templateId?:string;templateParameters?:Record<string,unknown>;workflowId?:string
 state:{nextRunAt?:string;lastRunAt?:string;lastRunId?:string;lastStatus?:AutomationRunStatus}
 createdAt:string;updatedAt:string
}

export type AutomationRunStatus='queued'|'running'|'retry-wait'|'succeeded'|'failed'|'cancelled'|'skipped'
export type AutomationRun={
 id:string;taskId:string;taskName:string;status:AutomationRunStatus;scheduledAt:string;startedAt?:string;finishedAt?:string
 agentTaskId?:string;agentTaskIds:string[];workflowRunId?:string;retryCount:number;nextRetryAt?:string;error?:string;summary?:string
}

export type AutomationTaskInput=Omit<AutomationTask,'id'|'state'|'createdAt'|'updatedAt'>&{id?:string}
export type AutomationTemplate={id:string;name:string;description:string;instruction:string;mode:Exclude<AgentMode,'chat'>;approvalMode:AgentApprovalMode;parameterSchema:Record<string,unknown>}

export type AutomationCommands={
 automationTasks:{input:undefined;output:AutomationTask[]}
 automationSave:{input:AutomationTaskInput;output:AutomationTask}
 automationDelete:{input:{id:string};output:void}
 automationAction:{input:{id:string;action:'enable'|'pause'|'run'};output:AutomationTask}
 automationRuns:{input:{taskId?:string;limit?:number}|undefined;output:AutomationRun[]}
 automationTemplates:{input:undefined;output:AutomationTemplate[]}
}
