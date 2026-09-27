import {parseWeatherRequest,weatherDate} from './weather-workflow.js'
import {weatherPageMatches} from './experience-flow.js'

/** Learn only a public source hostname from current page evidence, never a URL containing user parameters. */
export function weatherSources(query:string,activities:Array<{capability:string;status:string;output?:unknown}>):string[]{
 const request=parseWeatherRequest(query)
 if(!request?.city||!request.day)return []
 let date:string
 try{date=weatherDate(request.day,'Asia/Shanghai',new Date())}catch{return []}
 const hosts=new Set<string>()
 for(const activity of activities){
  if(activity.status!=='complete'||!['agent.web_fetch','browser.read_page'].includes(activity.capability))continue
  try{
   const data=typeof activity.output==='string'?JSON.parse(activity.output):activity.output
   if(!data||typeof data!=='object')continue
   const page=data as Record<string,unknown>,url=new URL(String(page.finalUrl||page.url||''))
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password||! /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname))continue
   if(typeof page.text==='string'&&weatherPageMatches(page.text,request.city,date))hosts.add(url.hostname.toLowerCase())
  }catch{/* An unreadable page is not a learned source. */}
 }
 return [...hosts].slice(0,3)
}
