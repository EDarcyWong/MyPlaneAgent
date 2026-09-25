export type DiffLine={kind:'same'|'added'|'removed';text:string;before?:number;after?:number}
export type DiffRow=DiffLine|{kind:'gap';count:number}
const lines=(text:string)=>text?text.replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n'):[]
export function fileDiff(before:string,after:string,limit=60000){
 const a=lines(before.slice(0,limit)),b=lines(after.slice(0,limit)),result:DiffLine[]=[]
 let start=0,end=0,oldLine=1,newLine=1
 const add=(kind:DiffLine['kind'],text:string)=>result.push({kind,text,before:kind==='added'?undefined:oldLine++,after:kind==='removed'?undefined:newLine++})
 while(start<a.length&&start<b.length&&a[start]===b[start]){add('same',a[start]);start++}
 while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++
 const old=a.slice(start,a.length-end),next=b.slice(start,b.length-end)
 // Bound quadratic work for large or completely rewritten files.
 if(old.length*next.length>1000000){old.forEach(text=>add('removed',text));next.forEach(text=>add('added',text))}
 else{
  const width=next.length+1,table=new Uint32Array((old.length+1)*width)
  for(let i=old.length-1;i>=0;i--)for(let j=next.length-1;j>=0;j--)table[i*width+j]=old[i]===next[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1])
  let i=0,j=0
  while(i<old.length||j<next.length){
   if(i<old.length&&j<next.length&&old[i]===next[j]){add('same',old[i++]);j++}
   else if(i<old.length&&(j===next.length||table[(i+1)*width+j]>=table[i*width+j+1]))add('removed',old[i++])
   else add('added',next[j++])
  }
 }
 for(let i=a.length-end;i<a.length;i++)add('same',a[i])
 return {lines:result,added:result.filter(row=>row.kind==='added').length,removed:result.filter(row=>row.kind==='removed').length,truncated:before.length>limit||after.length>limit,newlineChanged:before.endsWith('\n')!==after.endsWith('\n')}
}
export function collapseDiff(lines:DiffLine[],context=3):DiffRow[]{
 const rows:DiffRow[]=[]
 for(let i=0;i<lines.length;){
  if(lines[i].kind!=='same'){rows.push(lines[i++]);continue}
  let end=i;while(end<lines.length&&lines[end].kind==='same')end++
  const head=i===0?0:context,tail=end===lines.length?0:context
  if(end-i<=head+tail+1)rows.push(...lines.slice(i,end))
  else{rows.push(...lines.slice(i,i+head),{kind:'gap',count:end-i-head-tail},...lines.slice(end-tail,end))}
  i=end
 }
 return rows
}
