export type McpServerInput={id?:string;projectId:string;name:string;transport:'stdio'|'http';command?:string;args?:string[];url?:string;env?:Record<string,string>;token?:string;protocol?:'legacy'|'modern';enabledTools?:string[]}
export type McpServerView=Omit<McpServerInput,'env'|'token'>&{id:string;envKeys:string[];hasToken:boolean;status:'disconnected'|'connecting'|'connected'|'error';error?:string;identity?:string;tools:{name:string;description:string;enabled:boolean}[]}
export type McpCommands={
 mcpServers:{input:undefined;output:McpServerView[]}
 mcpSave:{input:McpServerInput;output:McpServerView}
 mcpConnect:{input:{id:string};output:McpServerView|null}
 mcpDisconnect:{input:{id:string};output:void}
 mcpDelete:{input:{id:string};output:void}
}
