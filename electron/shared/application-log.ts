export type ApplicationLogLevel='DEBUG'|'INFO'|'WARN'|'ERROR'
export type ApplicationLogEntry={timestamp:string;level:ApplicationLogLevel;scope:string;message:string}
export type ApplicationLogAction='read'|'clear'|'openDirectory'
export type ApplicationLogResult={entries:ApplicationLogEntry[];directory:string}
