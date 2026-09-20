import type {ExecutionRecord} from './agent-execution.js'
import type {StudioImage} from './local-ai-studio.js'
import type {ContextCheckpoint,ContextStatus} from './local-ai-context.js'
import type {TokenUsageTotals} from './local-ai-usage.js'
export type AgentMode='chat'|'coding'|'documents'|'general'
export type AgentStatus='running'|'waiting'|'completed'|'stopped'|'failed'
export type AgentPlanItem={text:string;status:'pending'|'running'|'completed'}
export type AgentPolicy='read-only'|'confirm'|'project-auto'
export type AgentApprovalMode='ask'|'auto'|'full'
export type AgentAudit={callId:string;source:string;risk:string;revision?:string;authorization?:'automatic'|'confirmed'|'denied';startedAt:string;endedAt?:string;durationMs?:number;errorCode?:string;exitCode?:number|null}
export type AgentPreview={changes?:{path:string;before?:string;after:string}[];path?:string;before?:string;after?:string;command?:string;cwd?:string;note?:string}
export type AgentEvent={steering?:'pending'|'applied';execution?:ExecutionRecord;resultId?:string;durationMs?:number;audit?:AgentAudit;images?:StudioImage[];reasoning?:string;id:string;kind:'user'|'assistant'|'tool';text:string;tool?:string;args?:Record<string,unknown>;status?:'running'|'waiting'|'completed'|'rejected'|'failed';preview?:AgentPreview;output?:string;createdAt:string}
export type AgentArtifact={path:string;kind:'file'|'document'|'spreadsheet';updatedAt:string}
export type AgentFilePreview={path:string;content:string;language:string;truncated:boolean;note?:string}
export type AgentProject={pinned?:boolean;policy?:AgentPolicy;autoWritePaths?:string[];memory?:string;id:string;name:string;workspace:string;createdAt:string;updatedAt:string}
export type AgentModelProgress={phase:'waiting'|'thinking'|'responding'|'tools';characters:number;toolNames?:string[];startedAt:string}
export type AgentTask={recoveryMaxTokens?:number;runStartedAt?:string;runCompletedAt?:string;approvalMode?:AgentApprovalMode;fastMode?:boolean;toolSnapshot?:{name:string;revision?:string;source:string}[];tokenBudget?:number;facts?:{goal:string;changedFiles:string[];verified:string[];pending:string[]};sourceSessionId?:string;checkpoint?:ContextCheckpoint;context?:ContextStatus;usage?:TokenUsageTotals;modelProgress?:AgentModelProgress;id:string;projectId?:string;title:string;workspace:string;mode:AgentMode;model:string;status:AgentStatus;steps:number;maxSteps:number;plan:AgentPlanItem[];events:AgentEvent[];artifacts:AgentArtifact[];error:string;createdAt:string;updatedAt:string}
export type AgentTaskSummary=Omit<AgentTask,'events'|'plan'|'artifacts'>
export type AgentStart={approvalMode?:AgentApprovalMode;fastMode?:boolean;tokenBudget?:number;sessionId?:string;images?:StudioImage[];projectId?:string;workspaceToken?:string;taskId?:string;mode:AgentMode;model:string;prompt:string;maxSteps:number}
export type AgentModelProfile={model:string;endpoint:string;testedAt:string;tools?:boolean;toolsTestedAt?:string;contextLength:number;image:'not-tested'|'passed'|'failed';imageTestedAt?:string;imagePassed?:number;lastTest?:'tools'|'image';elapsedMs?:number;lastUsage?:TokenUsageTotals;usage?:import('./local-ai-usage.js').TokenUsage;error?:string}
export type AgentCommands={
 agentSteer:{input:{id:string;messageId:string;prompt:string;images?:StudioImage[]};output:AgentTask}
 agentResolveExecution:{input:{id:string;eventId:string;outcome:'completed'|'not-applied';note:string};output:AgentTask}
 agentEditProject:{input:{id:string;name?:string;pinned?:boolean};output:AgentProject}
 agentRevealProject:{input:{id:string};output:void}
 agentUpdateProject:{input:{id:string;policy:AgentPolicy;autoWritePaths:string[];memory?:string};output:AgentProject}
 agentProbeModel:{input:{model:string;kind?:'tools'|'image'};output:AgentModelProfile}
 agentModelProfile:{input:{model:string};output:AgentModelProfile|null}
 agentStopModelProbe:{input:undefined;output:void}
 agentRestore:{input:{id:string;eventId:string};output:AgentTask}
 agentAudit:{input:{id:string};output:string}
 agentProjects:{input:undefined;output:AgentProject[]}
 agentCreateProject:{input:{workspaceToken:string;name:string};output:AgentProject}
 agentChooseWorkspace:{input:undefined;output:{path:string;token:string}|null}
 agentTasks:{input:undefined;output:AgentTaskSummary[]}
 agentTask:{input:{id:string};output:AgentTask}
 agentDelete:{input:{id:string};output:void}
 agentStart:{input:AgentStart;output:AgentTask}
 agentCompact:{input:{id:string};output:AgentTask}
 agentStop:{input:{id:string};output:void}
 agentApprove:{input:{id:string;eventId:string;approved:boolean};output:void}
 agentPreview:{input:{id:string;path:string};output:AgentFilePreview}
 agentReveal:{input:{id:string;path:string};output:void}
}
