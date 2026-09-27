export type ApprovalScope = 'once' | 'similar' | 'full';
type Operation = {capability:string;args:Record<string,unknown>};

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}

/** Owned by one running request; never persisted or shared with another run. */
export class ChatApprovalGrants {
  private operations = new Set<string>();
  private full = false;
  private key(operation:Operation){return JSON.stringify([operation.capability,canonical(operation.args)])}
  allows(operation:Operation){return this.full||this.operations.has(this.key(operation))}
  approve(operation:Operation,approved:boolean,scope:ApprovalScope='once'){
    if(!approved)return;
    if(scope==='full')this.full=true;
    else if(scope==='similar')this.operations.add(this.key(operation));
  }
}
