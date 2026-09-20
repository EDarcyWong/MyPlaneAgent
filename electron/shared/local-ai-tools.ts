export type AgentToolRisk='read'|'write'|'high'
export type AgentToolVersion={toolId:string;version:number;name:string;description:string;parameters:Record<string,unknown>;python:string;risk:AgentToolRisk;timeoutMs:number;runtimeRevision?:string;changeNote:string;createdAt:string}
export type AgentToolView={id:string;key:string;builtin:boolean;enabled:boolean;archived:boolean;activeVersion:number;current:AgentToolVersion;versions:AgentToolVersion[]}
export type AgentToolSaveInput={id?:string;key:string;name:string;description:string;parameters:Record<string,unknown>;python:string;risk:AgentToolRisk;timeoutMs:number;changeNote?:string}
export type AgentToolCommands={
 agentToolsList:{input:undefined;output:AgentToolView[]}
 agentToolSave:{input:AgentToolSaveInput;output:AgentToolView}
 agentToolToggle:{input:{id:string;enabled:boolean};output:AgentToolView}
 agentToolRestore:{input:{id:string;version:number};output:AgentToolView}
 agentToolTest:{input:{id:string;version?:number;projectId:string;arguments:Record<string,unknown>};output:{output:string;elapsedMs:number}}
}
