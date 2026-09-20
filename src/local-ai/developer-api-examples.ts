import {developerRoutes,type DeveloperRoute} from '../../electron/shared/local-ai-developer'

type Language='curl'|'python'|'javascript'|'powershell'

export function developerExample(route:DeveloperRoute,url:string,body:string,language:Language){
 const method=developerRoutes[route].method,post=method==='POST',anthropic=route==='messages'||route==='countTokens'
 const raw=body.trim()||'{}'
 const sh=(value:string)=>"'"+value.replaceAll("'","'\"'\"'")+"'"
 const ps=(value:string)=>"'"+value.replaceAll("'","''")+"'"
 if(language==='curl')return [
  `curl --no-buffer -X ${method} ${sh(url)}`,
  anthropic?'  -H "x-api-key: $MYPLANE_API_KEY"':'  -H "Authorization: Bearer $MYPLANE_API_KEY"',
  ...(anthropic?['  -H "anthropic-version: 2023-06-01"']:[]),
  ...(post?['  -H "Content-Type: application/json"',`  --data-raw ${sh(raw)}`]:[])
 ].join(' \\\n')
 if(language==='powershell')return [
  '$headers = @{',
  anthropic?'  "x-api-key" = $env:MYPLANE_API_KEY':'  Authorization = "Bearer $env:MYPLANE_API_KEY"',
  ...(anthropic?['  "anthropic-version" = "2023-06-01"']:[]),
  '}',
  ...(post?[`$body = ${ps(raw)}`]:[]),
  `Invoke-RestMethod -Method ${method} -Uri ${ps(url)} -Headers $headers${post?' -ContentType "application/json" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))':''}`
 ].join('\n')
 if(language==='python')return [
  'import json, os, urllib.request',
  '',
  'headers = {',
  anthropic?'    "x-api-key": os.environ["MYPLANE_API_KEY"],':'    "Authorization": "Bearer " + os.environ["MYPLANE_API_KEY"],',
  ...(anthropic?['    "anthropic-version": "2023-06-01",']:[]),
  '    "Content-Type": "application/json",',
  '}',
  ...(post?[`body = json.loads(${JSON.stringify(raw)})`]:[]),
  `request = urllib.request.Request(${JSON.stringify(url)}, method=${JSON.stringify(method)}, headers=headers${post?', data=json.dumps(body).encode("utf-8")':''})`,
  'with urllib.request.urlopen(request, timeout=310) as response:',
  '    for line in response:',
  '        print(line.decode("utf-8"), end="", flush=True)'
 ].join('\n')
 return [
  `const response = await fetch(${JSON.stringify(url)}, {`,
  `  method: ${JSON.stringify(method)},`,
  '  headers: {',
  anthropic?'    "x-api-key": process.env.MYPLANE_API_KEY,':'    Authorization: `Bearer ${process.env.MYPLANE_API_KEY}`,',
  ...(anthropic?['    "anthropic-version": "2023-06-01",']:[]),
  '    "Content-Type": "application/json",',
  '  },',
  ...(post?[`  body: JSON.stringify(JSON.parse(${JSON.stringify(raw)})),`]:[]),
  '});',
  'if (!response.ok) throw new Error(await response.text());',
  'const decoder = new TextDecoder();',
  'for await (const chunk of response.body) process.stdout.write(decoder.decode(chunk, { stream: true }));',
  'process.stdout.write(decoder.decode());'
 ].join('\n')
}
