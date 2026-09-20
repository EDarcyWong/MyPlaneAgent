import {onBeforeUnmount,ref,watch,type Ref} from 'vue'

export function useModelIcons(authors:Readonly<Ref<string[]>>){
 const modelIcons=ref<Record<string,string>>(Object.create(null))
 const requested=new Set<string>(),queue:string[]=[]
 let active=0,disposed=false
 function pump(){
  while(!disposed&&active<3&&queue.length){
   const author=queue.shift()!;active++
   void window.myplane.localAiStudio('modelIcon',{author}).then(image=>{
    if(!disposed&&image)modelIcons.value[author]=image
   }).catch(()=>{/* Keep the publisher initial when offline or no icon is available. */}).finally(()=>{active--;pump()})
  }
 }
 watch(authors,values=>{
  for(const author of new Set(values))if(author&&!requested.has(author)){requested.add(author);queue.push(author)}
  pump()
 },{immediate:true})
 onBeforeUnmount(()=>{disposed=true;queue.length=0})
 function iconFailed(author:string){delete modelIcons.value[author]}
 return {modelIcons,iconFailed}
}
