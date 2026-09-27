import type {ModuleJob,ModuleProblem} from '../../shared/ability-modules.js'
export function optimizationQueue(problems:ModuleProblem[],jobs:ModuleJob[],now=Date.now()){
 const ready:ModuleProblem[]=[],waiting:number[]=[];let exhausted=0,retries=0
 for(const problem of problems){
  const attempts=jobs.filter(job=>job.problemIds.includes(problem.id)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
  const last=attempts.at(-1)
  if(!last){ready.push(problem);continue}
  if(last.phase==='cancelled'||last.resolution==='improved'||last.resolution==='review'||last.resolution==='non-module'||['queued','analyzing','testing'].includes(last.phase))continue
  if(last.phase!=='failed'&&last.resolution!=='retryable')continue
  if(attempts.length>=3){exhausted++;continue}
  const at=Date.parse(last.retryAfter||'')||Date.parse(last.updatedAt)+(attempts.length===1?60_000:300_000)
  if(at>now)waiting.push(at)
  else{ready.push(problem);retries++}
 }
 return {ready,retries,exhausted,nextRetryAt:waiting.length?new Date(Math.min(...waiting)).toISOString():undefined}
}
