import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import {DOMParser} from '@xmldom/xmldom'

const xml=(text:string)=>text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
async function checkedZip(data:Buffer){
 const zip=await JSZip.loadAsync(data);let total=0
 for(const entry of Object.values(zip.files)){
  const size=(entry as unknown as {_data?:{uncompressedSize:number}})._data?.uncompressedSize||0
  total+=size;if(size>30*1024*1024||total>80*1024*1024)throw new Error('压缩文档展开后过大，请拆分文件')
 }
 return zip
}
export async function extractDocument(file:string,args:Record<string,unknown>,signal:AbortSignal){
 const st=fs.statSync(file);if(!st.isFile()||st.size>20*1024*1024)throw new Error('文档必须是 20 MB 以内的文件')
 const ext=path.extname(file).toLowerCase(),data=fs.readFileSync(file),sha256=createHash('sha256').update(data).digest('hex');let text='',note='';const locations:{label:string;offset:number;page?:number;paragraph?:number;sheet?:string;range?:string}[]=[],nextReads:Record<string,unknown>[]=[];const metadata:Record<string,unknown>={};let extractedCharacters=0
 if(args.expectedHash!==undefined&&args.expectedHash!==sha256)throw new Error('文档在分页读取期间已变化，请从头重新读取，避免混合不同版本。')
 const number=(value:unknown,fallback:number,min:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new Error('文档分页参数无效');return value}
 const offset=number(args.offset,0,0,80*1024*1024)
 signal.throwIfAborted()
 if(ext==='.docx'){
  const zip=await checkedZip(data),entry=zip.file('word/document.xml');if(!entry)throw new Error('Word 文档缺少正文')
  const source=await entry.async('string');if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('不支持包含实体声明的文档')
  const document=new DOMParser({errorHandler:{warning:()=>{},error:()=>{},fatalError:()=>{throw new Error('Word XML 格式损坏')}}}).parseFromString(source,'text/xml')
  const paragraphs=document.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p')
  const start=number(args.startParagraph,1,1,1000000);if(start>paragraphs.length&&paragraphs.length)throw new Error('Word 段落超出范围');let end=start-1
  for(let i=start-1;i<paragraphs.length&&text.length<500000;i++){
   end=i+1;
   locations.push({label:'段落 '+(i+1),paragraph:i+1,offset:text.length});const runs=paragraphs[i].getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t');for(let j=0;j<runs.length;j++)text+=runs[j].textContent||'';text+='\n'
  }
  Object.assign(metadata,{paragraphCount:paragraphs.length,startParagraph:start,endParagraph:end});if(end<paragraphs.length)nextReads.push({startParagraph:end+1,offset:0})
  note='提取正文及表格单元格文本；不含图片、批注、页眉页脚和原始排版。'
 }else if(ext==='.xlsx'){
  await checkedZip(data);const book=new ExcelJS.Workbook();await book.xlsx.load(data as unknown as Parameters<typeof book.xlsx.load>[0])
  if(book.worksheets.length>100)throw new Error('工作簿超过 100 个工作表，请先拆分')
  const sheets=args.sheet===undefined?book.worksheets:book.worksheets.filter(sheet=>sheet.name===args.sheet);if(!sheets.length)throw new Error('工作表不存在')
  const start=number(args.startRow,1,1,1048576),end=number(args.endRow,Math.min(start+1999,1048576),start,Math.min(start+1999,1048576)),startColumn=number(args.startColumn,1,1,16384),endColumn=number(args.endColumn,Math.min(startColumn+99,16384),startColumn,Math.min(startColumn+99,16384)),windows:Record<string,unknown>[]=[],uncachedFormulas:string[]=[]
  metadata.sheets=book.worksheets.map(sheet=>({name:sheet.name,rows:sheet.rowCount,columns:sheet.columnCount}));let truncatedColumns=false
  for(const sheet of sheets){signal.throwIfAborted();if(start>sheet.rowCount&&sheet.rowCount)throw new Error('工作表行号超出范围：'+sheet.name);let last=start-1;locations.push({label:'工作表 '+sheet.name,offset:text.length,sheet:sheet.name});text+=`\n## 工作表：${sheet.name}\n`
   for(let n=start;n<=Math.min(end,sheet.rowCount)&&text.length<500000;n++){last=n;const row=sheet.getRow(n);if(!row.hasValues)continue;const cells:string[]=[];truncatedColumns ||= row.cellCount>endColumn;const count=Math.min(row.cellCount,endColumn)
    for(let col=startColumn;col<=count;col++){const cell=row.getCell(col);cells.push(cell.text);if(cell.type===ExcelJS.ValueType.Formula&&(cell.value as ExcelJS.CellFormulaValue).result===undefined&&uncachedFormulas.length<20)uncachedFormulas.push(sheet.name+'!'+cell.address)}
    locations.push({label:'工作表 '+sheet.name+' 第 '+n+' 行',sheet:sheet.name,range:row.getCell(startColumn).address+':'+row.getCell(Math.max(startColumn,count)).address,offset:text.length});text+=`${n}: ${cells.join('\t')}\n`
    if(n%100===0){await new Promise(resolve=>setImmediate(resolve));signal.throwIfAborted()}
   }
   windows.push({sheet:sheet.name,startRow:start,endRow:last,startColumn,endColumn:Math.min(endColumn,sheet.columnCount),totalRows:sheet.rowCount});if(last>=start&&endColumn<sheet.columnCount)nextReads.push({sheet:sheet.name,startRow:start,endRow:last,startColumn:endColumn+1,offset:0});else if(last<sheet.rowCount)nextReads.push({sheet:sheet.name,startRow:last+1,offset:0})
  }
  Object.assign(metadata,{windows,truncatedColumns,uncachedFormulas});note='每个工作表每批最多 2000 行、100 列；先按 nextOffset 读完本批，再按 nextReads 继续。公式只显示缓存值，不重新计算。'
 }else if(ext==='.pdf'){
  const start=number(args.startPage,1,1,1000000),textlessPages:number[]=[];let last=start-1
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs')
  signal.throwIfAborted()
  const task=pdf.getDocument({data:new Uint8Array(data),useSystemFonts:true,disableFontFace:true,useWorkerFetch:false})
  const abort=()=>{void task.destroy()};signal.addEventListener('abort',abort,{once:true})
  try{const document=await task.promise;if(start>document.numPages)throw new Error(`PDF 共 ${document.numPages} 页`)
   for(let page=start;page<=Math.min(start+9,document.numPages);page++){signal.throwIfAborted();last=page;locations.push({label:'第 '+page+' 页',page,offset:text.length});const content=await(await document.getPage(page)).getTextContent();const pageText=content.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join('');extractedCharacters+=pageText.trim().length;if(!pageText.trim())textlessPages.push(page);text+=`\n## 第 ${page} 页\n`+pageText;if(text.length>500000)break}
   Object.assign(metadata,{pageCount:document.numPages,startPage:start,endPage:last,textlessPages,mayRequireOcr:!!textlessPages.length});if(last<document.numPages)nextReads.push({startPage:last+1,offset:0});note=`PDF 共 ${document.numPages} 页；本批第 ${start}–${last} 页。先按 nextOffset 读完本批，再按 nextReads 翻页。`+(textlessPages.length?'部分页未提取到文字，可能为空白页或扫描图片，需要检查原文或 OCR；不能声称已读懂这些页。':'仅提取文字，不包含图片识别。')
  }finally{signal.removeEventListener('abort',abort);await task.destroy()}
 }else if(['.txt','.md','.markdown','.csv','.tsv','.json','.html','.xml','.log'].includes(ext)){
  if(data.includes(0))throw new Error('此文档不是 UTF-8 文本');text=data.toString('utf8')
 }else throw new Error('支持 TXT、Markdown、CSV、JSON、HTML、DOCX、PDF、XLSX；旧版 DOC/XLS 请先转换')
 signal.throwIfAborted()
 if(offset>text.length)throw new Error('文本偏移超出当前批次，请检查 nextOffset 和分页参数')
 let length=20000
 while(true){
  if(length>1&&/[\uD800-\uDBFF]/.test(text[offset+length-1]||'')&&/[\uDC00-\uDFFF]/.test(text[offset+length]||''))length--
  const visible=locations.filter((location,index)=>location.offset<offset+length&&(locations[index+1]?.offset??text.length)>offset),nextOffset=offset+length<text.length?offset+length:null
  const continuation=nextOffset!==null?[{...args,offset:nextOffset}]:nextReads
  const result=JSON.stringify({path:path.basename(file),source:{sha256,bytes:data.length},text:text.slice(offset,offset+length),offset,totalCharacters:text.length,extractedCharacters:ext==='.pdf'?extractedCharacters:text.trim().length,locations:visible.slice(0,60),locationsTruncated:visible.length>60,nextOffset,nextReads:continuation.map(next=>({...next,expectedHash:sha256})),metadata,note})
  if(result.length<=36000)return result
  if(length<=250)throw new Error('文档来源信息过多，请指定工作表或缩小读取范围')
  length=Math.floor(length/2)
 }


}
export async function makeDocument(file:string,title:string,content:string){
 if(!file.toLowerCase().endsWith('.docx'))return Buffer.from(`# ${title}\n\n${content}\n`)
 const p=(text:string,style='')=>`<w:p>${style?`<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`:''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`
 const blocks:string[]=[p(title,'Title')],lines=content.split('\n')
 for(let i=0;i<lines.length;i++){
  const line=lines[i]
  if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
   const rows=[line];i+=2;while(i<lines.length&&lines[i].includes('|'))rows.push(lines[i++]);i--
   blocks.push('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="BFCFC5"/>`).join('')+'</w:tblBorders></w:tblPr>'+rows.map(row=>'<w:tr>'+row.trim().replace(/^\||\|$/g,'').split('|').map(cell=>`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(cell.trim())}</w:tc>`).join('')+'</w:tr>').join('')+'</w:tbl>')
  }else{const heading=line.match(/^(#{1,3})\s+(.+)$/);blocks.push(heading?p(heading[2],`Heading${heading[1].length}`):p(line.replace(/^\s*[-*]\s+/,'• ')))}
 }
 const zip=new JSZip()
 zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
 zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 zip.file('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
 zip.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`)
 zip.file('word/styles.xml',`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[['Title','36'],['Heading1','30'],['Heading2','26'],['Heading3','24']].map(([id,size],i)=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/>${i?`<w:outlineLvl w:val="${i-1}"/>`:''}</w:pPr><w:rPr><w:b/><w:color w:val="176344"/><w:sz w:val="${size}"/></w:rPr></w:style>`).join('')}</w:styles>`)
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
}
export async function makeSpreadsheet(value:unknown){
 if(!Array.isArray(value)||!value.length||value.length>10)throw new Error('需要 1–10 个工作表')
 const book=new ExcelJS.Workbook();book.creator='MyPlane Agent';let cells=0
 for(const raw of value){
  if(!raw||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>31||/[\\/*?:\[\]]/.test(raw.name)||!Array.isArray(raw.rows)||raw.rows.length>2000)throw new Error('工作表名称或行数据无效')
  const sheet=book.addWorksheet(raw.name)
  for(const row of raw.rows){if(!Array.isArray(row)||row.length>100)throw new Error('每行最多 100 列');cells+=row.length;if(cells>20000)throw new Error('表格最多 20000 单元格');sheet.addRow(row.map(cell=>{if(cell!==null&&typeof cell!=='string'&&typeof cell!=='number')throw new Error('单元格仅支持文本、数字或 null');if(typeof cell==='string'&&cell.length>10000)throw new Error('单元格内容过长');if(typeof cell==='number'&&!Number.isFinite(cell))throw new Error('数字无效');return cell}))}
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176344'}}
  sheet.columns.forEach(column=>{column.width=24;column.alignment={vertical:'top',wrapText:true}})
 }
 return Buffer.from(await book.xlsx.writeBuffer())
}
