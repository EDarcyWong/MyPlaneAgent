import type {AgentApprovalMode,AgentMode} from './local-ai-agent.js'

export type WorkflowBranch={id:string;name:string;condition:string;color:string;targetNodeIds?:string[];targetNodeId?:string;outputValue?:string}
export type WorkflowInputParameter={name:string;value:string}
export type WorkflowNodeBase={id:string;name:string;branches?:WorkflowBranch[];onSuccess?:string;onFailure?:string}
export type WorkflowAgentNode=WorkflowNodeBase&{type:'agent';config:{instruction:string;model:string;mode:Exclude<AgentMode,'chat'>;maxSteps:number;fastMode:boolean;approvalMode:AgentApprovalMode;inputs?:WorkflowInputParameter[];inputSignalMode?:'all'|'any'}}
export type WorkflowConditionNode=WorkflowNodeBase&{type:'condition';config:{sourceNodeId:string;operator:'succeeded'|'failed'}}
export type WorkflowNotifyNode=WorkflowNodeBase&{type:'notify';config:{title:string;body:string}}
export type WorkflowNode=WorkflowAgentNode|WorkflowConditionNode|WorkflowNotifyNode
export type WorkflowLayout={nodes:Record<string,{x:number;y:number}>;start?:{x:number;y:number}}

export type WorkflowDefinition={id:string;name:string;description:string;projectId:string;enabled:boolean;version:number;entryNodeId:string;nodes:WorkflowNode[];layout?:WorkflowLayout;timeoutMinutes:number;createdAt:string;updatedAt:string}
export type WorkflowDefinitionInput=Omit<WorkflowDefinition,'id'|'version'|'createdAt'|'updatedAt'>&{id?:string}
export type WorkflowNodeRun={nodeId:string;nodeName:string;type:WorkflowNode['type'];status:'running'|'succeeded'|'failed'|'skipped';startedAt:string;finishedAt?:string;agentTaskId?:string;summary?:string;error?:string;branchId?:string;branchName?:string;outputValue?:string}
export type WorkflowRun={id:string;workflowId:string;workflowName:string;workflowVersion:number;projectId:string;status:'running'|'waiting'|'succeeded'|'failed'|'cancelled';currentNodeId?:string;pendingNodeIds?:string[];nodeInputSignals?:Record<string,string[]>;nodeRuns:WorkflowNodeRun[];agentTaskIds:string[];startedAt:string;finishedAt?:string;error?:string;summary?:string;resumedFromRunId?:string}

export type WorkflowCommands={
 workflowDefinitions:{input:undefined;output:WorkflowDefinition[]}
 workflowSave:{input:WorkflowDefinitionInput;output:WorkflowDefinition}
 workflowDelete:{input:{id:string};output:void}
 workflowAction:{input:{id:string;action:'run'|'enable'|'pause'};output:WorkflowDefinition|WorkflowRun}
 workflowRuns:{input:{workflowId?:string;limit?:number}|undefined;output:WorkflowRun[]}
 workflowCancel:{input:{runId:string};output:WorkflowRun}
 workflowRetry:{input:{runId:string;nodeId:string};output:WorkflowRun}
}
