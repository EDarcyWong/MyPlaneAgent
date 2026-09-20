"""MyPlane Agent tool worker. One JSON request on stdin, one JSON response on stdout."""
from __future__ import annotations
import ast, contextlib, csv, difflib, hashlib, io, ipaddress, json, mimetypes, os, pathlib, re, socket, subprocess, sys, tarfile, tempfile, time, urllib.error, urllib.parse, urllib.request, zipfile
from html import escape, unescape
from xml.etree import ElementTree as ET

IGNORED={'.git','node_modules','dist','dist-electron','release','vendor','.idea','.venv','venv','__pycache__'}
SECRET=re.compile(r'(^\.env(?:\.|$)|^\.ssh$|^\.aws$|^\.gnupg$|^credentials(?:\.json)?$|^id_rsa$|^id_ed25519$|\.(?:pem|key|p12|pfx)$)',re.I)
TEXT_EXT={'.txt','.md','.markdown','.csv','.tsv','.json','.html','.xml','.log'}
CODE_EXT={'.py','.pyi','.js','.jsx','.mjs','.cjs','.ts','.tsx','.vue','.svelte','.java','.kt','.kts','.cs','.go','.rs','.c','.h','.cc','.cpp','.hpp','.rb','.php','.swift'}
BINARY_DOCUMENT_EXT={'.doc','.docx','.xls','.xlsx','.ppt','.pptx','.pdf','.odt','.ods','.odp','.rtf','.zip','.7z','.rar','.png','.jpg','.jpeg','.gif','.webp','.bmp','.tif','.tiff'}
TEXT_CACHE={}
LIST_CACHE={}

def compact(value): return json.dumps(value,ensure_ascii=True,separators=(',',':'))
def sha(data): return hashlib.sha256(data).hexdigest()
def root_path(context): return pathlib.Path(context['workspace']).resolve(strict=True)
def trim_cache(cache,maximum):
    while len(cache)>maximum: cache.pop(next(iter(cache)))
def invalidate(root,paths=None):
    prefix=str(root)+os.sep
    if paths:
        selected={str(path) for path in paths}
        for key in list(TEXT_CACHE):
            if key[0] in selected: TEXT_CACHE.pop(key,None)
    else:
        for key in list(TEXT_CACHE):
            if key[0].startswith(prefix): TEXT_CACHE.pop(key,None)
    for key in list(LIST_CACHE):
        if key[0]==str(root): LIST_CACHE.pop(key,None)
def resolve(root,value,missing=False):
    if not isinstance(value,str) or not value.strip() or len(value)>2000 or '\\' in value or '\0' in value or ':' in value or pathlib.PurePath(value).is_absolute(): raise ValueError('请使用工作区内的相对路径')
    parts=[p for p in value.split('/') if p and p!='.']
    if any(p=='..' or p.lower() in IGNORED or SECRET.search(p) or re.search(r'[<>:"|?*\x00-\x1f]',p) or p[-1:] in '. ' for p in parts): raise ValueError('此路径不允许访问（越界、依赖目录或敏感文件）')
    target=root.joinpath(*parts)
    current=root
    for part in parts:
        current=current/part
        if current.exists():
            if current.is_symlink(): raise ValueError('不允许访问符号链接')
            if current.is_file() and current.stat().st_nlink>1: raise ValueError('不允许访问具有多个硬链接的文件')
        elif not missing: raise FileNotFoundError(str(value))
    return target
def read_text(root,name):
    file=resolve(root,name);stat=file.stat()
    if not file.is_file() or stat.st_size>2*1024*1024: raise ValueError('仅可读取 2 MB 以内的 UTF-8 文本文件')
    key=(str(file),stat.st_mtime_ns,stat.st_size);cached=TEXT_CACHE.get(key)
    if cached is not None: return cached
    data=file.read_bytes()
    if b'\0' in data: raise ValueError('仅可读取 2 MB 以内的 UTF-8 文本文件')
    text=data.decode('utf-8')
    for old in [item for item in TEXT_CACHE if item[0]==str(file) and item!=key]: TEXT_CACHE.pop(old,None)
    TEXT_CACHE[key]=text;trim_cache(TEXT_CACHE,512);return text
def directory_stamp(folder):
    stat=folder.stat();return (stat.st_mtime_ns,tuple(sorted(item.name for item in folder.iterdir())))
def listing(root,relative='.',depth=4,limit=500):
    base=resolve(root,relative);key=(str(root),str(base),depth,limit);cached=LIST_CACHE.get(key)
    if cached:
        try:
            if all(directory_stamp(pathlib.Path(folder))==stamp for folder,stamp in cached[0]): return {'paths':list(cached[1]['paths']),'truncated':cached[1]['truncated'],'cached':True}
        except OSError: pass
    result=[];visited=0;truncated=False;directories=[]
    def walk(folder,level):
        nonlocal visited,truncated
        if level>depth: truncated=True;return
        children=sorted(folder.iterdir(),key=lambda p:p.name.lower());directories.append((str(folder),(folder.stat().st_mtime_ns,tuple(sorted(child.name for child in children)))))
        for child in children:
            visited+=1
            if visited>5000 or len(result)>=limit: truncated=True;return
            if child.name in IGNORED or SECRET.search(child.name) or child.is_symlink(): continue
            rel=child.relative_to(root).as_posix()
            if child.is_dir(): result.append(rel+'/');walk(child,level+1)
            elif child.is_file(): result.append(rel)
    if not base.is_dir(): raise ValueError('请选择目录')
    walk(base,0);value={'paths':result,'truncated':truncated};LIST_CACHE[key]=(directories,value);trim_cache(LIST_CACHE,64);return value
def git(root,args,action):
    meta=root/'.git'
    if not meta.exists() or meta.is_symlink(): raise ValueError('需要项目根目录中的 Git 仓库')
    env={'PATH':os.environ.get('PATH',''),'SystemRoot':os.environ.get('SystemRoot',''),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'NUL' if os.name=='nt' else '/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_LITERAL_PATHSPECS':'1'}
    base=['git','--no-pager','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.hooksPath=/dev/null','-c','diff.external=','-c','core.pager=cat']
    def run(more):
        done=subprocess.run(base+more,cwd=root,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=15)
        output=(done.stdout+done.stderr)[:32000]
        if done.returncode: raise ValueError('Git 未成功：'+output[:1000])
        return output
    if pathlib.Path(run(['rev-parse','--show-toplevel']).strip()).resolve()!=root: raise ValueError('Git 根目录与项目目录不一致')
    if action=='git_status': return compact({'output':run(['status','--short','--untracked-files=no','--ignore-submodules=all'])})
    if action=='git_log': return compact({'output':run(['log','-n',str(max(1,min(30,int(args.get('limit',10))))),'--format=%h %s'])})
    if action in ('git_show','git_blame'):
        ref=str(args.get('ref','HEAD'))
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/^~-]{0,199}',ref) or '..' in ref or '@{' in ref or ref.startswith('-'): raise ValueError('Git 引用格式无效')
        if action=='git_show':
            selected=[]
            if args.get('path'):
                file=resolve(root,args['path']);
                if not file.is_file(): raise ValueError('Git 查看目标必须是文件')
                selected=['--',file.relative_to(root).as_posix()]
            command=['show','--no-ext-diff','--no-textconv','--ignore-submodules=all','--format=fuller','--stat','--patch' if args.get('patch') is True else '--no-patch',ref,*selected]
            return compact({'ref':ref,'path':args.get('path'),'output':run(command)})
        file=resolve(root,args['path'])
        if not file.is_file(): raise ValueError('Git blame 目标必须是文件')
        start=max(1,int(args.get('startLine',1)));end=min(start+249,max(start,int(args.get('endLine',start+99))))
        return compact({'ref':ref,'path':args['path'],'startLine':start,'endLine':end,'output':run(['blame','--date=iso-strict','-L',f'{start},{end}',ref,'--',file.relative_to(root).as_posix()])})
    staged=['--cached'] if args.get('staged') is True else []
    names=[n for n in run(['diff',*staged,'--name-only','-z','--ignore-submodules=all']).split('\0') if n]
    allowed=[]
    for name in names[:100]:
        try: resolve(root,name,True);allowed.append(name)
        except Exception: pass
    return compact({'output':run(['diff',*staged,'--no-ext-diff','--no-textconv','--ignore-submodules=all','--',*allowed]) if allowed else '','note':'仅显示允许访问路径中的已跟踪文件差异。'})
def extract_docx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        source=z.read('word/document.xml');tree=ET.fromstring(source)
    ns='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    return '\n'.join(''.join(t.text or '' for t in p.iter(ns+'t')) for p in tree.iter(ns+'p'))
def xlsx_strings(z):
    try: root=ET.fromstring(z.read('xl/sharedStrings.xml'))
    except KeyError: return []
    ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    return [''.join(t.text or '' for t in node.iter(ns+'t')) for node in root.iter(ns+'si')]
def extract_xlsx(data):
    lines=[]
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        shared=xlsx_strings(z);names=sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$',n))
        ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        for index,name in enumerate(names,1):
            lines.append(f'\n## 工作表 {index}')
            root=ET.fromstring(z.read(name))
            for row in root.iter(ns+'row'):
                values=[]
                for cell in row.iter(ns+'c'):
                    value=cell.find(ns+'v');text='' if value is None else value.text or ''
                    if cell.get('t')=='s' and text.isdigit() and int(text)<len(shared): text=shared[int(text)]
                    elif cell.get('t')=='inlineStr': text=''.join(node.text or '' for node in cell.iter(ns+'t'))
                    values.append(text)
                lines.append(f"{row.get('r','')}: "+'\t'.join(values))
    return '\n'.join(lines)
def read_document(root,args):
    file=resolve(root,args['path']);data=file.read_bytes()
    if len(data)>20*1024*1024: raise ValueError('文档必须是 20 MB 以内的文件')
    ext=file.suffix.lower();digest=sha(data);offset=int(args.get('offset',0))
    if args.get('expectedHash') not in (None,digest): raise ValueError('文档在分页读取期间已变化，请从头读取')
    note='';metadata={};next_reads=[]
    if ext=='.docx': text=extract_docx(data);note='提取 Word 正文和表格文本，不包含图片与原始排版。'
    elif ext=='.xlsx': text=extract_xlsx(data);note='提取工作表缓存值，不重新计算公式。'
    elif ext=='.pdf':
        try:
            from pypdf import PdfReader
            reader=PdfReader(io.BytesIO(data));start=max(1,int(args.get('startPage',1)));pages=[]
            for page in range(start,min(start+10,len(reader.pages)+1)): pages.append(f'\n## 第 {page} 页\n'+(reader.pages[page-1].extract_text() or ''))
            text=''.join(pages);metadata={'pageCount':len(reader.pages),'startPage':start,'endPage':min(start+9,len(reader.pages))}
            if metadata['endPage']<len(reader.pages): next_reads=[{'path':args['path'],'startPage':metadata['endPage']+1,'expectedHash':digest}]
            note='PDF 每批最多读取 10 页，仅提取文字。'
        except ImportError: raise ValueError('Python PDF 工具需要 pypdf，请为 MyPlane Python 运行时安装 requirements.txt')
    elif ext in TEXT_EXT:
        if b'\0' in data: raise ValueError('文档不是 UTF-8 文本')
        text=data.decode('utf-8')
    else: raise ValueError('支持 TXT、Markdown、CSV、JSON、HTML、DOCX、PDF、XLSX')
    if offset>len(text): raise ValueError('文本偏移超出范围')
    visible=text[offset:offset+20000];next_offset=offset+len(visible) if offset+len(visible)<len(text) else None
    if next_offset is not None: next_reads=[{**args,'offset':next_offset,'expectedHash':digest}]
    return compact({'path':args['path'],'source':{'sha256':digest,'bytes':len(data)},'text':visible,'offset':offset,'totalCharacters':len(text),'nextOffset':next_offset,'nextReads':next_reads,'metadata':metadata,'note':note})
def office_xml(value):
    # XML 1.0 forbids most control characters. Word treats a package containing
    # one of them as corrupt even when the ZIP and XML are otherwise readable.
    return escape(re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(value)),quote=True)
def docx_bytes(title,content):
    def paragraph(text,style=None):
        style_xml=f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
        return f'<w:p>{style_xml}<w:r><w:t xml:space="preserve">{office_xml(text)}</w:t></w:r></w:p>'
    blocks=[paragraph(title,'Title')];lines=content.splitlines();index=0
    while index<len(lines):
        line=lines[index]
        if '|' in line and index+1<len(lines) and re.match(r'^\s*\|?\s*:?-{3,}',lines[index+1]):
            rows=[line];index+=2
            while index<len(lines) and '|' in lines[index]: rows.append(lines[index]);index+=1
            cells=[]
            for row in rows:
                values=row.strip().strip('|').split('|')
                cells.append('<w:tr>'+''.join('<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'+paragraph(value.strip())+'</w:tc>' for value in values)+'</w:tr>')
            borders=''.join(f'<w:{side} w:val="single" w:sz="4" w:color="BFCFC5"/>' for side in ('top','left','bottom','right','insideH','insideV'))
            blocks.append('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+borders+'</w:tblBorders></w:tblPr>'+''.join(cells)+'</w:tbl>')
            continue
        heading=re.match(r'^(#{1,3})\s+(.+)$',line)
        blocks.append(paragraph(heading.group(2),f'Heading{len(heading.group(1))}') if heading else paragraph(re.sub(r'^\s*[-*]\s+','• ',line)))
        index+=1
    document='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>'+''.join(blocks)+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>'
    styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    for style,size,level in [('Title','36',None),('Heading1','30',0),('Heading2','26',1),('Heading3','24',2)]:
        outline='' if level is None else f'<w:outlineLvl w:val="{level}"/>'
        styles+=f'<w:style w:type="paragraph" w:styleId="{style}"><w:name w:val="{style}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/>{outline}</w:pPr><w:rPr><w:b/><w:color w:val="176344"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>'
    styles+='</w:styles>'
    parts={
        '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
        '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
        'word/document.xml':document,
        'word/_rels/document.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        'word/styles.xml':styles,
        'word/settings.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat/></w:settings>',
        'docProps/core.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>'+office_xml(title)+'</dc:title><dc:creator>MyPlane Agent</dc:creator><cp:lastModifiedBy>MyPlane Agent</cp:lastModifiedBy></cp:coreProperties>',
        'docProps/app.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MyPlane</Application><AppVersion>1.0</AppVersion></Properties>'
    }
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,value in parts.items(): archive.writestr(name,value)
    data=out.getvalue()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.testzip() is not None: raise ValueError('生成的 Word 文档压缩包损坏')
        for name in (item for item in archive.namelist() if item.endswith('.xml')): ET.fromstring(archive.read(name))
    return data
def column_name(number):
    out=''
    while number: number,rest=divmod(number-1,26);out=chr(65+rest)+out
    return out
def xlsx_bytes(sheets):
    out=io.BytesIO();content=['<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
    for i in range(len(sheets)): content.append(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    content.append('</Types>')
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',''.join(content));z.writestr('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheet_defs=[];rels=[]
        for i,sheet in enumerate(sheets,1):
            sheet_defs.append(f'<sheet name="{sheet["name"]}" sheetId="{i}" r:id="rId{i}"/>');rels.append(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>')
            rows=[]
            for rn,row in enumerate(sheet['rows'],1):
                cells=[]
                for cn,value in enumerate(row,1):
                    ref=f'{column_name(cn)}{rn}'
                    if isinstance(value,(int,float)): cells.append(f'<c r="{ref}"><v>{value}</v></c>')
                    elif value is not None: cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{str(value).replace("&","&amp;").replace("<","&lt;")}</t></is></c>')
                rows.append(f'<row r="{rn}">{"".join(cells)}</row>')
            z.writestr(f'xl/worksheets/sheet{i}.xml','<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+''.join(rows)+'</sheetData></worksheet>')
        z.writestr('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+''.join(sheet_defs)+'</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(rels)+'</Relationships>')
    return out.getvalue()
def prepare_write(root,tool,args):
    if tool=='apply_patch':
        changes=[];seen=set()
        for item in args['changes']:
            file=resolve(root,item['path'],True);identity=os.path.normcase(str(file))
            if identity in seen: raise ValueError('同一文件只能出现一次')
            seen.add(identity);before=file.read_bytes().decode('utf-8') if file.exists() else None
            if file.suffix.lower() in BINARY_DOCUMENT_EXT: raise ValueError('文本补丁不能写入二进制文档；DOCX 请使用 create_document，XLSX 请使用 create_spreadsheet')
            if before!=item.get('before'): raise ValueError('补丁基线不匹配，请重新读取 '+item['path'])
            changes.append({'path':item['path'],'before':before,'after':item['after'],'expected':sha(before.encode()) if before is not None else None})
        return {'preview':{'changes':[{k:v for k,v in c.items() if k in ('path','before','after')} for c in changes],'note':'Python 多文件补丁；执行前会再次核对基线。'},'plan':{'kind':'files','changes':changes},'artifact':None}
    if tool in ('run_command','run_test'):
        command=args.get('command') if tool=='run_command' else 'npm run '+args['script']
        if tool=='run_test':
            if not re.match(r'^(test|check|lint|build)(:[A-Za-z0-9_-]+)?$',args['script']): raise ValueError('测试脚本名称无效')
            package=json.loads(read_text(root,'package.json'))
            if args['script'] not in package.get('scripts',{}): raise ValueError('项目未定义此脚本')
        return {'preview':{'command':command,'cwd':str(root),'note':'命令以当前用户权限执行，需要确认。'},'plan':{'kind':'command','command':command,'timeout':max(1,min(300,int(args.get('timeoutSeconds',60))))},'artifact':None}
    relative=args['path'];file=resolve(root,relative,True);before=file.read_bytes() if file.exists() else None
    if tool in ('write_file','replace_text') and file.suffix.lower() in BINARY_DOCUMENT_EXT: raise ValueError('通用文本工具不能写入二进制文档；DOCX 请使用 create_document，XLSX 请使用 create_spreadsheet')
    if tool=='write_file': data=args['content'].encode();kind='file';shown=args['content']
    elif tool=='replace_text':
        if before is None: raise ValueError('待修改文件不存在')
        source=before.decode();old=args['oldText']
        if source.count(old)!=1: raise ValueError('待替换片段必须唯一匹配')
        shown=source.replace(old,args['newText']);data=shown.encode();kind='file'
    elif tool=='create_document':
        if not re.search(r'\.(docx|md|txt)$',relative,re.I): raise ValueError('文档输出仅支持 .docx、.md、.txt；Word 文档必须使用 .docx，不能使用 .doc')
        kind='document';shown='# '+args['title']+'\n\n'+args['content'];data=docx_bytes(args['title'],args['content']) if relative.lower().endswith('.docx') else shown.encode()
    elif tool=='create_spreadsheet': kind='spreadsheet';shown=compact(args['sheets']);data=xlsx_bytes(args['sheets'])
    else: raise ValueError('未知写入工具')
    return {'preview':{'path':relative,'before':before.decode(errors='replace') if before and kind=='file' else None,'after':shown,'note':'由 Python 工具生成；确认时会重新检查文件版本。'},'plan':{'kind':'files','changes':[{'path':relative,'afterHex':data.hex(),'expected':sha(before) if before is not None else None}]},'artifact':{'path':relative,'kind':kind}}
def execute_plan(root,plan):
    if plan['kind']=='command':
        started=time.time();done=subprocess.run(plan['command'],cwd=root,shell=True,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=plan['timeout'])
        invalidate(root)
        return compact({'exitCode':done.returncode,'durationMs':round((time.time()-started)*1000),'output':(done.stdout+done.stderr)[:32000]})
    changes=plan['changes'];prepared=[];seen=set()
    for change in changes:
        file=resolve(root,change['path'],True);identity=os.path.normcase(str(file))
        if identity in seen: raise ValueError('同一文件只能出现一次')
        seen.add(identity);current=file.read_bytes() if file.exists() else None
        if (sha(current) if current is not None else None)!=change.get('expected'): raise ValueError('文件在确认期间已被修改：'+change['path'])
        data=bytes.fromhex(change['afterHex']) if 'afterHex' in change else change['after'].encode()
        prepared.append((change,file,data,current,file.stat().st_mode & 0o777 if file.exists() else 0o644))
    def atomic_write(file,data,mode):
        file.parent.mkdir(parents=True,exist_ok=True);name=None
        try:
            with tempfile.NamedTemporaryFile(dir=file.parent,delete=False) as tmp: tmp.write(data);name=tmp.name
            os.chmod(name,mode);os.replace(name,file)
        finally:
            if name and os.path.exists(name): os.unlink(name)
    applied=[]
    try:
        for change,file,data,before,mode in prepared:
            resolve(root,change['path'],True);current=file.read_bytes() if file.exists() else None
            if (sha(current) if current is not None else None)!=change.get('expected'): raise ValueError('文件在执行期间发生变化：'+change['path'])
            atomic_write(file,data,mode);applied.append((change,file,data,before,mode))
    except Exception as error:
        pending=[]
        for change,file,data,before,mode in reversed(applied):
            try:
                resolve(root,change['path'])
                if sha(file.read_bytes())!=sha(data): raise ValueError('出现后续修改')
                if before is None: file.unlink()
                else: atomic_write(file,before,mode)
            except Exception: pending.append(change['path'])
        raise ValueError(str(error)+('；回退未完成，请核对：'+','.join(pending) if pending else '；已回退本次写入')) from error
    invalidate(root,[file for _,file,_,_,_ in prepared])
    return compact({'status':'saved','paths':[c['path'] for c in changes]})

def code_files(root,relative='.',limit=1800):
    paths=[]
    for name in listing(root,relative,8,limit)['paths']:
        if not name.endswith('/') and pathlib.Path(name).suffix.lower() in CODE_EXT: paths.append(name)
    return paths

def inspect_project(root,args):
    base=resolve(root,args.get('path','.'),False);relative=base.relative_to(root).as_posix() or '.'
    markers=['package.json','pyproject.toml','requirements.txt','Pipfile','Cargo.toml','go.mod','pom.xml','build.gradle','build.gradle.kts','composer.json','Gemfile']
    found=[name for name in markers if (base/name).is_file()]
    languages={};files=0;directories=[]
    for child in sorted(base.iterdir(),key=lambda item:item.name.lower()):
        if child.name in IGNORED or SECRET.search(child.name) or child.is_symlink(): continue
        if child.is_dir(): directories.append(child.name+'/')
    for name in listing(root,relative,5,2500)['paths']:
        if name.endswith('/'): continue
        files+=1;ext=pathlib.Path(name).suffix.lower()
        labels={'.py':'Python','.ts':'TypeScript','.tsx':'TypeScript JSX','.js':'JavaScript','.jsx':'JavaScript JSX','.vue':'Vue','.go':'Go','.rs':'Rust','.java':'Java','.cs':'C#','.php':'PHP','.rb':'Ruby'}
        if ext in labels: languages[labels[ext]]=languages.get(labels[ext],0)+1
    result={'path':relative,'markers':found,'directories':directories[:80],'fileCount':files,'languages':dict(sorted(languages.items(),key=lambda item:-item[1]))}
    package=base/'package.json'
    if package.is_file():
        data=json.loads(package.read_text('utf-8'));deps={**data.get('dependencies',{}),**data.get('devDependencies',{})}
        frameworks=[name for name in ['vue','react','next','nuxt','svelte','electron','vite','express','nestjs','playwright','vitest','jest'] if name in deps or '@'+name in deps]
        result['package']={'name':data.get('name'),'type':data.get('type'),'scripts':data.get('scripts',{}),'frameworks':frameworks,'dependencyCount':len(deps)}
    pyproject=base/'pyproject.toml'
    if pyproject.is_file(): result['python']={'pyproject':pyproject.read_text('utf-8')[:12000]}
    return compact(result)

def code_outline(root,args):
    file=resolve(root,args['path']);ext=file.suffix.lower()
    if not file.is_file() or ext not in CODE_EXT: raise ValueError('请选择支持的代码文件')
    text=read_text(root,args['path']);symbols=[]
    if ext in ('.py','.pyi'):
        try: tree=ast.parse(text)
        except SyntaxError as error: raise ValueError(f'Python 语法错误：第 {error.lineno or 0} 行 {error.msg}')
        def visit(nodes,parent=''):
            for node in nodes:
                if isinstance(node,(ast.ClassDef,ast.FunctionDef,ast.AsyncFunctionDef)):
                    kind='class' if isinstance(node,ast.ClassDef) else 'function' if not parent else 'method'
                    name=f'{parent}.{node.name}' if parent else node.name
                    symbols.append({'name':name,'kind':kind,'line':node.lineno,'endLine':getattr(node,'end_lineno',node.lineno),'async':isinstance(node,ast.AsyncFunctionDef)})
                    visit(node.body,name if kind=='class' else parent)
                elif isinstance(node,(ast.Import,ast.ImportFrom)):
                    names=[alias.name for alias in node.names];symbols.append({'name':', '.join(names),'kind':'import','line':node.lineno,'endLine':node.lineno})
        visit(tree.body)
    else:
        patterns=[
          ('class',re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|enum|struct|trait)\s+([A-Za-z_$][\w$]*)')),
          ('type',re.compile(r'^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b')),
          ('function',re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b')),
          ('function',re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^\n]*\)|[A-Za-z_$][\w$]*)\s*=>')),
          ('function',re.compile(r'^\s*(?:pub\s+)?(?:async\s+)?(?:fn|func)\s+([A-Za-z_$][\w$]*)\b')),
          ('method',re.compile(r'^\s*(?:public|private|protected|static|async|override|final|open|suspend|virtual|abstract|\s)+\s*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^={]+)?[{:=>]'))]
        for line_number,line in enumerate(text.splitlines(),1):
            for kind,pattern in patterns:
                match=pattern.search(line)
                if match: symbols.append({'name':match.group(1),'kind':kind,'line':line_number,'text':line.strip()[:500]});break
    return compact({'path':args['path'],'language':ext.lstrip('.'),'symbols':symbols[:500],'count':len(symbols),'truncated':len(symbols)>500})

def find_todos(root,args):
    tags=[str(tag).upper() for tag in args.get('tags') or ['TODO','FIXME','HACK','XXX']]
    if any(not re.fullmatch(r'[A-Z][A-Z0-9_-]{1,19}',tag) for tag in tags): raise ValueError('待办标签格式无效')
    limit=max(1,min(500,int(args.get('limit',200))));matcher=re.compile(r'\b('+'|'.join(map(re.escape,tags))+r')\b[:\s-]*(.*)',re.I);matches=[];counts={tag:0 for tag in tags};scanned=0
    for name in code_files(root,args.get('path','.'),3000):
        try: lines=read_text(root,name).splitlines();scanned+=1
        except Exception: continue
        for line_number,line in enumerate(lines,1):
            match=matcher.search(line)
            if not match: continue
            tag=match.group(1).upper();counts[tag]=counts.get(tag,0)+1;matches.append({'path':name,'line':line_number,'tag':tag,'text':match.group(2).strip()[:500]})
            if len(matches)>=limit: return compact({'matches':matches,'counts':counts,'scanned':scanned,'truncated':True})
    return compact({'matches':matches,'counts':counts,'scanned':scanned,'truncated':False})

def dependency_report(root,args):
    base=resolve(root,args.get('path','.'),False)
    if not base.is_dir(): raise ValueError('依赖报告路径必须是目录')
    result={'path':base.relative_to(root).as_posix() or '.','manifests':[],'lockfiles':[],'dependencies':{},'scripts':{}}
    package=base/'package.json'
    if package.is_file():
        data=json.loads(package.read_text('utf-8'));result['manifests'].append('package.json');result['scripts']=data.get('scripts',{})
        for section in ('dependencies','devDependencies','peerDependencies','optionalDependencies'):
            values=data.get(section,{})
            if isinstance(values,dict): result['dependencies'][section]=[{'name':name,'version':version} for name,version in sorted(values.items())][:1000]
    requirements=base/'requirements.txt'
    if requirements.is_file():
        rows=[]
        for line in requirements.read_text('utf-8').splitlines():
            value=line.strip()
            if value and not value.startswith(('#','-r','--')): rows.append(value[:500])
        result['manifests'].append('requirements.txt');result['dependencies']['pythonRequirements']=rows[:1000]
    pyproject=base/'pyproject.toml'
    if pyproject.is_file():
        result['manifests'].append('pyproject.toml')
        try:
            import tomllib
            data=tomllib.loads(pyproject.read_text('utf-8'));project=data.get('project',{});poetry=data.get('tool',{}).get('poetry',{})
            result['dependencies']['pythonProject']=project.get('dependencies',[])[:1000] if isinstance(project.get('dependencies',[]),list) else []
            if isinstance(poetry.get('dependencies'),dict): result['dependencies']['poetry']=[{'name':name,'version':version} for name,version in sorted(poetry['dependencies'].items())][:1000]
        except Exception as error: result['pyprojectWarning']=str(error)[:500]
    locks=['package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb','poetry.lock','Pipfile.lock','uv.lock','Cargo.lock','go.sum','composer.lock','Gemfile.lock']
    result['lockfiles']=[name for name in locks if (base/name).is_file()]
    result['counts']={section:len(values) for section,values in result['dependencies'].items()}
    return compact(result)

def file_info(root,args):
    target=resolve(root,args['path']);stat=target.stat();result={'path':args['path'],'kind':'directory' if target.is_dir() else 'file','modifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(stat.st_mtime))}
    if target.is_dir():
        children=[item for item in target.iterdir() if item.name not in IGNORED and not SECRET.search(item.name) and not item.is_symlink()]
        result.update({'entries':len(children),'files':sum(item.is_file() for item in children),'directories':sum(item.is_dir() for item in children)});return compact(result)
    data=target.read_bytes() if stat.st_size<=50*1024*1024 else None
    result.update({'bytes':stat.st_size,'extension':target.suffix.lower(),'mimeType':mimetypes.guess_type(target.name)[0] or 'application/octet-stream','sha256':sha(data) if data is not None else None})
    if data is not None: result['binary']=b'\0' in data;result['lines']=None if result['binary'] else len(data.decode('utf-8','replace').splitlines())
    else: result['hashNote']='文件超过 50 MB，未计算哈希'
    return compact(result)

def compare_files(root,args):
    left=read_text(root,args['left']);right=read_text(root,args['right']);context=max(0,min(20,int(args.get('contextLines',3))))
    rows=list(difflib.unified_diff(left.splitlines(),right.splitlines(),fromfile=args['left'],tofile=args['right'],n=context,lineterm=''));output='\n'.join(rows)
    return compact({'left':args['left'],'right':args['right'],'identical':not rows,'output':output[:60000],'totalCharacters':len(output),'truncated':len(output)>60000})

def archive_inspect(root,args):
    file=resolve(root,args['path']);limit=max(1,min(1000,int(args.get('limit',300))))
    if not file.is_file() or file.stat().st_size>200*1024*1024: raise ValueError('请选择 200 MB 以内的压缩包')
    entries=[];total=0;kind=''
    if zipfile.is_zipfile(file):
        kind='zip'
        with zipfile.ZipFile(file) as archive:
            infos=archive.infolist();total=len(infos)
            for item in infos[:limit]: entries.append({'path':item.filename[:2000],'bytes':item.file_size,'compressedBytes':item.compress_size,'directory':item.is_dir(),'encrypted':bool(item.flag_bits&1),'suspicious':pathlib.PurePosixPath(item.filename).is_absolute() or '..' in pathlib.PurePosixPath(item.filename).parts})
    elif tarfile.is_tarfile(file):
        kind='tar'
        with tarfile.open(file,'r:*') as archive:
            members=archive.getmembers();total=len(members)
            for item in members[:limit]: entries.append({'path':item.name[:2000],'bytes':item.size,'directory':item.isdir(),'link':item.issym() or item.islnk(),'suspicious':pathlib.PurePosixPath(item.name).is_absolute() or '..' in pathlib.PurePosixPath(item.name).parts})
    else: raise ValueError('支持 ZIP、JAR、WHL、DOCX、XLSX、TAR、TGZ 和 TAR.GZ')
    return compact({'path':args['path'],'kind':kind,'archiveBytes':file.stat().st_size,'entryCount':total,'entries':entries,'truncated':total>limit})

def find_symbol(root,args):
    query=str(args['query']);kind=args.get('kind','any');matches=[]
    if not re.fullmatch(r'[A-Za-z_$][\w$.-]{0,299}',query): raise ValueError('符号名称格式无效')
    plain=query.split('.')[-1]
    patterns={
      'class':rf'\b(?:class|interface|enum|struct|trait)\s+{re.escape(plain)}\b',
      'function':rf'\b(?:function\s+{re.escape(plain)}|def\s+{re.escape(plain)}|fn\s+{re.escape(plain)}|func\s+{re.escape(plain)}|{re.escape(plain)}\s*=\s*(?:async\s*)?\([^\n]*\)\s*=>)',
      'method':rf'\b(?:def\s+{re.escape(plain)}|{re.escape(plain)}\s*\([^\n]*\)\s*[:{{])',
      'variable':rf'\b(?:const|let|var|static|final)\s+{re.escape(plain)}\b',
      'type':rf'\b(?:type|interface|class|enum|struct)\s+{re.escape(plain)}\b'}
    selected=list(patterns.values()) if kind=='any' else [patterns[kind]]
    matcher=re.compile('|'.join(f'(?:{pattern})' for pattern in selected))
    for name in code_files(root,args.get('path','.'),2200):
        try: lines=read_text(root,name).splitlines()
        except Exception: continue
        for index,line in enumerate(lines,1):
            if matcher.search(line): matches.append({'path':name,'line':index,'text':line.strip()[:500]})
            if len(matches)>=80: return compact({'query':query,'matches':matches,'truncated':True})
    return compact({'query':query,'matches':matches,'truncated':False})

def find_references(root,args):
    query=str(args['query'])
    if not re.fullmatch(r'[A-Za-z_$][\w$]{0,299}',query): raise ValueError('引用名称必须是单个标识符')
    matcher=re.compile(r'(?<![\w$])'+re.escape(query)+r'(?![\w$])');matches=[];scanned=0
    for name in code_files(root,args.get('path','.'),2400):
        try: lines=read_text(root,name).splitlines();scanned+=1
        except Exception: continue
        for index,line in enumerate(lines,1):
            if matcher.search(line): matches.append({'path':name,'line':index,'text':line.strip()[:500]})
            if len(matches)>=120: return compact({'query':query,'matches':matches,'scanned':scanned,'truncated':True})
    return compact({'query':query,'matches':matches,'scanned':scanned,'truncated':False})

def parsed_diagnostics(output):
    rows=[]
    patterns=[re.compile(r'^(.*?)[(:](\d+)[,:](\d+)\)?\s*[:\-]\s*(?:error\s*)?(.*)$',re.I),re.compile(r'^(.+?):(\d+):\s*(.*)$')]
    for line in output.splitlines():
        for pattern in patterns:
            match=pattern.match(line.strip())
            if match:
                groups=match.groups();rows.append({'path':groups[0],'line':int(groups[1]),'column':int(groups[2]) if len(groups)>3 else None,'message':groups[-1][:1000]});break
        if len(rows)>=200: break
    return rows

def diagnostics(root,args):
    target=resolve(root,args.get('path','.'),False);checker=args.get('checker','auto');timeout=max(1,min(300,int(args.get('timeoutSeconds',120))))
    package=root/'package.json';pyproject=root/'pyproject.toml';command=[]
    if checker in ('auto','typescript') and package.is_file():
        data=json.loads(package.read_text('utf-8'));scripts=data.get('scripts',{});script=next((name for name in ('check','typecheck','lint') if name in scripts),None)
        if script: command=['npm.cmd' if os.name=='nt' else 'npm','run',script]
        else:
            local=root/'node_modules'/'.bin'/('tsc.cmd' if os.name=='nt' else 'tsc')
            if local.is_file(): command=[str(local),'--noEmit','--pretty','false']
    if not command and checker in ('auto','python') and (pyproject.is_file() or any(root.glob('*.py'))): command=[sys.executable,'-m','compileall','-q',str(target)]
    if not command: raise ValueError('未找到可用的 TypeScript 检查脚本、tsc 或 Python 项目')
    started=time.time();done=subprocess.run(command,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
    invalidate(root)
    output=(done.stdout+done.stderr)[:100000]
    return compact({'command':command,'exitCode':done.returncode,'durationMs':round((time.time()-started)*1000),'diagnostics':parsed_diagnostics(output),'output':output[:32000],'truncated':len(output)>32000})

def run_test_case(root,args):
    target=resolve(root,args['target'],False)
    if not target.is_file(): raise ValueError('测试目标必须是文件')
    runner=args.get('runner','auto');name=str(args.get('name','')).strip();timeout=max(1,min(300,int(args.get('timeoutSeconds',120))))
    if runner=='pytest' or runner=='auto' and target.suffix.lower()=='.py':
        command=[sys.executable,'-m','pytest',target.relative_to(root).as_posix()]
        if name: command+=['-k',name]
    else:
        package=json.loads(read_text(root,'package.json'))
        if 'test' not in package.get('scripts',{}): raise ValueError('package.json 未定义 test 脚本')
        command=['npm.cmd' if os.name=='nt' else 'npm','run','test','--','--run',target.relative_to(root).as_posix()]
        if name: command+=['-t',name]
    started=time.time();done=subprocess.run(command,cwd=root,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout);invalidate(root);output=(done.stdout+done.stderr)
    passed=len(re.findall(r'\b(?:pass(?:ed)?|✓)\b',output,re.I));failed=len(re.findall(r'\b(?:fail(?:ed)?|✗)\b',output,re.I))
    return compact({'command':command,'exitCode':done.returncode,'durationMs':round((time.time()-started)*1000),'passedMarkers':passed,'failedMarkers':failed,'output':output[:50000],'truncated':len(output)>50000})

def process_status(args):
    query=str(args.get('query','')).lower();port=args.get('port');limit=max(1,min(100,int(args.get('limit',30))));rows=[];listeners=[]
    if os.name=='nt':
        done=subprocess.run(['tasklist','/fo','csv','/nh'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=15)
        for row in csv.reader(io.StringIO(done.stdout)):
            if len(row)>=5 and (not query or query in row[0].lower()): rows.append({'name':row[0],'pid':int(row[1]) if row[1].isdigit() else row[1],'session':row[2],'memory':row[4]})
        net=subprocess.run(['netstat','-ano','-p','tcp'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=15)
        for line in net.stdout.splitlines():
            fields=line.split()
            if len(fields)>=5 and fields[0].upper()=='TCP' and fields[3].upper()=='LISTENING':
                try: local_port=int(fields[1].rsplit(':',1)[1])
                except Exception: continue
                if port is None or local_port==int(port): listeners.append({'address':fields[1],'pid':int(fields[4])})
    else:
        done=subprocess.run(['ps','-eo','pid=,comm=,rss='],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=15)
        for line in done.stdout.splitlines():
            fields=line.split(None,2)
            if len(fields)>=2 and (not query or query in fields[1].lower()): rows.append({'pid':int(fields[0]),'name':fields[1],'memoryKb':int(fields[2]) if len(fields)>2 and fields[2].isdigit() else None})
    return compact({'processes':rows[:limit],'listeners':listeners[:limit],'truncated':len(rows)>limit or len(listeners)>limit})

def local_http(args):
    url=str(args['url']);parsed=urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password: raise ValueError('URL 必须是没有凭据的 http/https 地址')
    try: addresses={item[4][0] for item in socket.getaddrinfo(parsed.hostname,parsed.port or (443 if parsed.scheme=='https' else 80),type=socket.SOCK_STREAM)}
    except OSError as error: raise ValueError('无法解析请求主机：'+str(error))
    if not addresses or any(not ipaddress.ip_address(address).is_loopback for address in addresses): raise ValueError('当前版本仅允许访问 localhost 本机服务')
    method=args.get('method','GET');headers={str(key):str(value) for key,value in args.get('headers',{}).items()};body=args.get('body')
    request=urllib.request.Request(url,data=None if body is None else str(body).encode(),headers=headers,method=method)
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,response_headers,newurl):
            target=urllib.parse.urlsplit(newurl)
            if target.hostname not in ('localhost','127.0.0.1','::1'): raise urllib.error.HTTPError(newurl,403,'拒绝跳转到非本机地址',response_headers,fp)
            return super().redirect_request(req,fp,code,msg,response_headers,newurl)
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),SafeRedirect())
    try:
        response=opener.open(request,timeout=max(1,min(120,int(args.get('timeoutSeconds',30)))))
    except urllib.error.HTTPError as error: response=error
    data=response.read(1024*1024+1);truncated=len(data)>1024*1024;data=data[:1024*1024]
    return compact({'status':response.status,'url':response.geturl(),'headers':dict(list(response.headers.items())[:50]),'body':data.decode('utf-8','replace'),'truncated':truncated})

def image_ocr(root,args):
    file=resolve(root,args['path']);data=file.read_bytes();ext=file.suffix.lower()
    if ext not in {'.png','.jpg','.jpeg','.webp','.bmp','.tif','.tiff'} or len(data)>20*1024*1024: raise ValueError('OCR 支持 20 MB 以内的 PNG、JPEG、WEBP、BMP 或 TIFF 图片')
    languages=str(args.get('languages','')).strip()
    try:
        from rapidocr_onnxruntime import RapidOCR
        engine=RapidOCR();result,_=engine(str(file));rows=result or [];text='\n'.join(str(row[1]) for row in rows);confidence=sum(float(row[2]) for row in rows)/len(rows) if rows else None;provider='rapidocr-onnxruntime'
    except ImportError:
        try:
            import pytesseract
            from PIL import Image
            language='+'.join(part.strip() for part in languages.split(',') if part.strip()) or None;text=pytesseract.image_to_string(Image.open(file),lang=language);confidence=None;provider='pytesseract'
        except ImportError: raise ValueError('未安装 OCR 依赖。请安装 python/requirements.txt 后重试')
        except Exception as error: raise ValueError('Tesseract OCR 不可用：'+str(error))
    return compact({'path':args['path'],'provider':provider,'languages':languages or 'auto','text':text[:100000],'characters':len(text),'confidence':confidence,'truncated':len(text)>100000})

def builtin(tool,args,context):
    root=root_path(context);phase=context.get('phase','execute')
    if tool=='load_tool_pack':
        pack=str(args.get('pack',''))
        if pack not in {'code','tests','git','dependencies','runtime','images','archives','compare','todos','documents'}: raise ValueError('工具包名称无效')
        return compact({'loaded':pack,'message':'工具包将在下一轮模型请求中生效'})
    if tool=='set_plan':
        steps=args.get('steps')
        if not isinstance(steps,list) or not 1<=len(steps)<=12: raise ValueError('计划需要 1–12 个步骤')
        return compact({'steps':steps})
    if tool=='read_history':
        query=str(args.get('query','')).lower();offset=max(0,int(args.get('offset',0)));rows=[]
        for index,message in enumerate(context.get('history',[]),1):
            row={'index':index,**message}
            if not query or query in compact(row).lower(): rows.append(compact(row))
        text='\n'.join(rows)
        return compact({'text':text[offset:offset+6000],'totalCharacters':len(text),**({'nextOffset':offset+6000} if offset+6000<len(text) else {}),'note':'本任务的原始历史资料；请结合当前文件验证。'})
    if phase=='plan': return prepare_write(root,tool,args)
    if phase=='commit': return execute_plan(root,context['plan'])
    if tool.startswith('git_'): return git(root,args,tool)
    if tool=='inspect_project': return inspect_project(root,args)
    if tool=='code_outline': return code_outline(root,args)
    if tool=='find_symbol': return find_symbol(root,args)
    if tool=='find_references': return find_references(root,args)
    if tool=='find_todos': return find_todos(root,args)
    if tool=='dependency_report': return dependency_report(root,args)
    if tool=='file_info': return file_info(root,args)
    if tool=='compare_files': return compare_files(root,args)
    if tool=='archive_inspect': return archive_inspect(root,args)
    if tool=='get_diagnostics': return diagnostics(root,args)
    if tool=='run_test_case': return run_test_case(root,args)
    if tool=='process_status': return process_status(args)
    if tool=='http_request': return local_http(args)
    if tool=='image_ocr': return image_ocr(root,args)
    if tool=='list_files': return compact(listing(root,args.get('path','.'),max(0,min(8,int(args.get('depth',4))))))
    if tool=='read_file':
        lines=read_text(root,args['path']).splitlines();start=max(1,int(args.get('startLine',1)));end=min(len(lines),int(args.get('endLine',start+199)),start+249)
        return compact({'path':args['path'],'totalLines':len(lines),'startLine':start,'endLine':end,'text':'\n'.join(f'{i}: {lines[i-1]}' for i in range(start,end+1))[:24000]})
    if tool=='search_files':
        query=args['query'].lower();matches=[];scanned=0
        for name in listing(root,args.get('path','.'),8,1200)['paths']:
            if name.endswith('/'): continue
            try: lines=read_text(root,name).splitlines();scanned+=1
            except Exception: continue
            for index,line in enumerate(lines,1):
                if query in line.lower(): matches.append({'path':name,'line':index,'text':line[:400]})
                if len(matches)>=60: break
            if len(matches)>=60: break
        return compact({'matches':matches,'scanned':scanned,'truncated':len(matches)>=60})
    if tool=='read_document': return read_document(root,args)
    if tool in {'write_file','replace_text','apply_patch','create_document','create_spreadsheet','run_command','run_test'}: return prepare_write(root,tool,args)
    raise ValueError('未知 Python 内置工具：'+tool)
def handle(request):
    workspace=pathlib.Path(request['workspace']).resolve(strict=True)
    if not workspace.is_dir(): raise ValueError('工作目录不存在')
    context={**request.get('context',{}),'workspace':str(workspace)};previous=pathlib.Path.cwd()
    captured=io.StringIO()
    try:
        os.chdir(workspace)
        with contextlib.redirect_stdout(captured),contextlib.redirect_stderr(captured):
            if request.get('code'):
                scope={'__builtins__':__builtins__,'builtin':builtin,'json':json,'pathlib':pathlib};exec(compile(request['code'],'<agent-tool>','exec'),scope);result=scope['execute'](request.get('args',{}),context)
            else: result=builtin(request['tool'],request.get('args',{}),context)
    finally: os.chdir(previous)
    return result if isinstance(result,str) else compact(result)
def main():
    request=json.loads(sys.stdin.buffer.read().decode('utf-8'));print(compact({'output':handle(request)}))
def serve():
    for raw in sys.stdin.buffer:
        request_id=''
        try:
            request=json.loads(raw.decode('utf-8'));request_id=str(request.get('id',''))
            if not request_id: raise ValueError('缺少请求 ID')
            response={'id':request_id,'output':handle(request)}
        except Exception as error: response={'id':request_id,'error':f'{type(error).__name__}: {error}'}
        print(compact(response),flush=True)
if __name__=='__main__':
    try: serve() if '--server' in sys.argv[1:] else main()
    except Exception as error: print(compact({'error':f'{type(error).__name__}: {error}'}));sys.exit(1)
