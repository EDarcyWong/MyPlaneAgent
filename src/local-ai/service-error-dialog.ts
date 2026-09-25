import {AppMessageBox as ElMessageBox} from './message-box'

const logEvent='myplane:open-application-logs'

export function applicationLogRequested(callback:()=>void){
 const listener=()=>callback()
 window.addEventListener(logEvent,listener)
 return()=>window.removeEventListener(logEvent,listener)
}

export function serviceErrorText(cause:unknown){
 return String(cause).replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/,'')
}

export async function showServiceStartError(cause:unknown){
 const message=serviceErrorText(cause)
 try{
  await ElMessageBox.confirm(message,'服务启动失败',{type:'error',confirmButtonText:'打开日志输出',cancelButtonText:'关闭',closeOnClickModal:false,closeOnPressEscape:true})
  window.dispatchEvent(new Event(logEvent))
 }catch{/* Closing the error dialog needs no follow-up action. */}
 return message
}

export async function showServiceValidationError(cause:unknown){
 const message=serviceErrorText(cause)||'服务验证失败，但服务端没有返回具体错误信息。'
 try{
  await ElMessageBox.confirm(message,'服务验证失败',{type:'error',confirmButtonText:'打开日志输出',cancelButtonText:'关闭',closeOnClickModal:false,closeOnPressEscape:true})
  window.dispatchEvent(new Event(logEvent))
 }catch{/* Closing the error dialog needs no follow-up action. */}
 return message
}
