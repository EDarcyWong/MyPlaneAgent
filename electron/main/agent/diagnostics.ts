export function diagnosticText(value: string, key = ''): string {
  let result = key ? value.split(key).join('[REDACTED]') : value;
  result = result
    .replace(/data:(?:image|audio|video)\/[^;,]+;base64,[a-z0-9+/=]+/gi,'[MEDIA_DATA_REDACTED]')
    .replace(/(bearer\s+)[^\s"',;]+/gi,'$1[REDACTED]')
    .replace(/\b(?:sk-ant-[a-z0-9_-]{12,}|sk-[a-z0-9_-]{12,}|hf_[a-z0-9]{12,})\b/gi,'[REDACTED]')
    .replace(/((?:api.?key|authorization|password|secret|token)["']?\s*[:=]\s*)["']?[^\s,"';}]+["']?/gi,'$1[REDACTED]');
  return result.length > 131072 ? result.slice(0,65536)+'\n[对话过长，中间内容已截断]\n'+result.slice(-65536) : result;
}

export function writeConversationDiagnostic(sink:(message:string)=>void, value:{taskId:string;model:string;request:string;response:string;error?:string}) {
  const prefix = `AI 对话诊断 / 任务 ${value.taskId} / 模型 ${value.model}`;
  sink(`${prefix} / 错误：${value.error}`);
  for (const [label,body] of [['请求对话',value.request],['模型返回',value.response]]) {
    const parts = Math.max(1,Math.ceil(body.length/1500));
    for(let index=0;index<parts;index++) sink(`${prefix} / ${label} ${index+1}/${parts}\n${body.slice(index*1500,(index+1)*1500)}`);
  }
}
