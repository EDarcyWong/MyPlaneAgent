export type TaskVerificationRule =
  | {kind:'file';path:string;contains?:string}
  | {kind:'test';script:string}
  | {kind:'diagnostics';checker:'auto'|'typescript'|'python';path?:string}
export type VerificationIssue = {key:string;category:'code'|'environment'|'unknown';message:string;path?:string;advice?:string}
export type VerificationComparison = {
  failures:Array<{issue:VerificationIssue;origin:'new'|'existing'|'unknown';related:boolean}>;
  resolved:VerificationIssue[];
}
export type TaskVerificationResult = {rule:TaskVerificationRule;passed:boolean;blocked?:boolean;summary:string;fingerprint:string;activityId?:string;issues?:VerificationIssue[];issuesComplete?:boolean}
export type TaskVerificationRun = {createdAt:string;results:TaskVerificationResult[];passed:boolean;comparison?:VerificationComparison}
export type TaskReviewAction={title:string;capability:string;args:Record<string,unknown>;basis:string;required:boolean}
export type TaskReviewCheck=TaskReviewAction&{id:string;signature:string;revision:number;status:'pending'|'running'|'complete'|'failed'|'invalid'|'deferred';attempts:number;activityId?:string;summary?:string}
export type TaskReviewQueue={phase?:'implement'|'verify';implementationRecovery?:boolean;implementationEvidence?:string[];fileRevision?:number;revision:number;checks:TaskReviewCheck[]}
export type TaskCompletionReview = {status:'complete'|'continue'|'needs_input'|'blocked';reason:string;nextStep:string;implementation?:{status:'missing'|'present'|'unknown';evidenceIds:string[]};missingEvidence?:string[];actions?:TaskReviewAction[];optionalChecks?:string[]}
export type TaskItem = {
  id:string; title:string; acceptance:string;
  parentId?:string;depth?:number;childIds?:string[];
  status:'pending'|'running'|'verifying'|'complete'|'blocked';
  attempts:number; summary:string; evidenceIds:string[];
  reviewQueue?:TaskReviewQueue;
  visualResponses?:Array<import('./visual-review.js').VisualDecision & {createdAt:string}>;
  outcome?:'complete'|'needs_input'|'blocked';completionReview?:TaskCompletionReview;
  verification?:TaskVerificationRule[];verificationRuns?:TaskVerificationRun[];repairAttempts?:number;repairPending?:boolean;modifiedFiles?:string[];requiresVerification?:boolean;
  verificationProblem?:{input:unknown;message:string;attempts:number};
  verificationRepairs?:Array<{createdAt:string;input:unknown;output?:string;error?:string}>;
  baseline?:TaskVerificationRun;baselineHistory?:TaskVerificationRun[];baselineUnavailableReason?:string;mutationStarted?:boolean;
  excludedProjectChecks?:Array<{createdAt:string;reason:string;rules:TaskVerificationRule[];baseline?:TaskVerificationRun;runs?:TaskVerificationRun[]}>;
}
export type TaskPlan = {scope?:import('./task-scope.js').TaskScope;needsReplan?:boolean;editProgress?:import('../main/agent/core/edit-progress.js').EditProgressState;taskId:string;workspace:string;items:TaskItem[];updatedAt:string}
