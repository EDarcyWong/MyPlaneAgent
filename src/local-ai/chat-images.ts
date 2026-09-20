import {chatImages,maxChatImageBytes,maxChatImages} from '../../electron/shared/local-ai-chat'
import type {StudioImage} from '../../electron/shared/local-ai-studio'

export function clipboardImageFiles(data:DataTransfer|null):File[]{
 if(!data)return []
 const items=Array.from(data.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file)
 return items.length?items:Array.from(data.files).filter(file=>file.type.startsWith('image/'))
}

export async function readChatImages(files:File[],existing:StudioImage[]):Promise<StudioImage[]>{
 if(existing.length+files.length>maxChatImages)throw new Error('每条消息最多添加 4 张图片')
 const added:StudioImage[]=[]
 for(const file of files){
  if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type))throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片')
  if(file.size>maxChatImageBytes)throw new Error('每条消息的图片总大小不能超过 4 MB')
  const dataUrl=await new Promise<string>((resolve,reject)=>{
   const reader=new FileReader()
   reader.onload=()=>resolve(String(reader.result))
   reader.onerror=()=>reject(new Error('图片读取失败，请重新粘贴'))
   reader.onabort=()=>reject(new Error('图片读取已取消'))
   reader.readAsDataURL(file)
  })
  added.push({name:file.name||'粘贴的图片',dataUrl})
  chatImages([...existing,...added])
 }
 return [...existing,...added]
}
