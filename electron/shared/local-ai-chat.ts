import type {StudioImage,StudioMessage} from './local-ai-studio.js'

export const maxChatImages=4
export const maxChatImageBytes=4*1024*1024
export const maxSessionImageChars=8_000_000

export function chatImages(value:unknown):StudioImage[]{
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>maxChatImages)throw new Error('每条消息最多添加 4 张图片')
 let bytes=0
 return value.map(item=>{
  if(!item||typeof item!=='object'||typeof item.dataUrl!=='string'||item.dataUrl.length>Math.ceil(maxChatImageBytes/3)*4+64)throw new Error('图片无效或超过 4 MB')
  const match=/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.dataUrl)
  if(!match||match[2].length%4)throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片')
  bytes+=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0)
  if(bytes>maxChatImageBytes)throw new Error('每条消息的图片总大小不能超过 4 MB')
  return {name:typeof item.name==='string'?item.name.slice(0,200):'粘贴的图片',dataUrl:item.dataUrl}
 })
}

export function chatMessageContent(message:StudioMessage){
 if(message.role!=='user'||!message.images?.length)return message.content
 return [
  ...(message.content?[{type:'text' as const,text:message.content}]:[]),
  ...chatImages(message.images).map(image=>({type:'image_url' as const,image_url:{url:image.dataUrl}}))
 ]
}
