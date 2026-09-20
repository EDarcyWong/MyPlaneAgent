import {readdirSync,statSync} from 'node:fs'
import path from 'node:path'

export function isVisionProjector(file:string){return /^mmproj(?:[-_.].*)?\.gguf$/i.test(path.basename(file))}

export function findVisionProjector(modelPath:string):string|undefined{
 if(isVisionProjector(modelPath))throw new Error('视觉组件不能单独运行，请加载与它配套的语言模型')
 const directory=path.dirname(modelPath)
 let names:string[]
 try{names=readdirSync(directory)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
 const files=names.filter(isVisionProjector).map(name=>path.join(directory,name)).filter(file=>statSync(file).isFile())
 if(files.length>1)throw new Error('模型目录中有多个视觉组件，无法确定配对关系；请将对应的一个 mmproj 文件与模型放在单独目录后重新加载')
 return files[0]
}
