import readline from 'node:readline'
import fs from 'node:fs'
const tool={name:'echo',description:'Return a test message',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}
const send=value=>process.stdout.write(JSON.stringify(value)+'\n')
for await(const line of readline.createInterface({input:process.stdin})){
 let request;try{request=JSON.parse(line)}catch{continue}
 if(!('id'in request))continue
 let result
 if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:'fixture',version:'1.0'}}
 else if(request.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}},_meta:{'io.modelcontextprotocol/serverInfo':{name:'fixture',version:'1.0'}}}
 else if(request.method==='ping')result={}
 else if(request.method==='tools/list')result={tools:[tool],ttlMs:0,cacheScope:'private'}
 else if(request.method==='tools/call'){
  const text=request.params.arguments.text
  if(process.env.CALL_LOG)fs.appendFileSync(process.env.CALL_LOG,JSON.stringify(request.params)+'\n')
  if(text==='disconnect'){process.exit(0)}
  if(text==='changed'){send({jsonrpc:'2.0',method:'notifications/tools/list_changed'})}
  result={content:[{type:'text',text:'echo: '+text}],isError:text==='fail'}
 }else{send({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unknown method'}});continue}
 send({jsonrpc:'2.0',id:request.id,result:{resultType:'complete',...result}})
}
