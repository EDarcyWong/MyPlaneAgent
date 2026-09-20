export type ExecutionState='prepared'|'running'|'verifying'|'succeeded'|'failed'|'unknown'|'not-applied'
export type FailureKind='arguments'|'conflict'|'environment'|'verification'|'timeout'|'cancelled'|'unknown'|'tool'
export type FileExpectation={path:string;beforeHash:string|null;afterHash:string}
export type ExecutionRecord={
 id:string;taskId:string;tool:string;source:string;revision?:string;argumentHash:string
 state:ExecutionState;effectful:boolean;createdAt:string;updatedAt:string
 expectedFiles:FileExpectation[];exitCode?:number|null
 verification?:{status:'passed'|'failed'|'unverified';summary:string}
 failure?:{kind:FailureKind;message:string;nextAction:string}
 resolution?:{by:'file-hash'|'user';note:string}
}
