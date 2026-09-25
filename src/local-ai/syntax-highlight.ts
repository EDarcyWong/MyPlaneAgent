const keywordLists:Record<string,string>={
 javascript:'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined',
 typescript:'abstract any as asserts async await bigint boolean break case catch class const constructor continue declare default delete do else enum export extends false finally from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of override private protected public readonly require return set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield',
 python:'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case',
 java:'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record sealed permits',
 csharp:'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await record init required',
 cpp:'alignas alignof and asm auto bitand bitor bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast requires return short signed sizeof static static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor',
 go:'break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var true false nil',
 rust:'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
 kotlin:'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg',
 swift:'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try async await actor',
 php:'abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include instanceof insteadof interface isset list match namespace new null or print private protected public readonly require return static switch throw trait true try unset use var while xor yield false',
 ruby:'BEGIN END alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
 sql:'add all alter and any as asc backup database between by case check column constraint create database default delete desc distinct drop exec exists foreign from full group having in index inner insert into is join key left like limit not null or order outer primary procedure right rownum select set table top truncate union unique update values view where with',
 shell:'case do done elif else esac fi for function if in select then time until while coproc true false',
 css:'align-content align-items animation background border bottom box-shadow color content cursor display filter flex float font gap grid height justify-content left line-height margin max-height max-width min-height min-width opacity overflow padding position right text-align top transform transition width z-index important',
 json:'true false null',
 yaml:'true false null yes no on off',
}
export const syntaxAliases:Record<string,string>={
 js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',node:'javascript',ts:'typescript',tsx:'typescript',mts:'typescript',cts:'typescript',py:'python',pyw:'python',cs:'csharp',c:'cpp',cc:'cpp',cpp:'cpp',cxx:'cpp',h:'cpp',hpp:'cpp',golang:'go',rs:'rust',kt:'kotlin',kts:'kotlin',swift:'swift',php:'php',rb:'ruby',sql:'sql',html:'markup',htm:'markup',xml:'markup',vue:'markup',svelte:'markup',svg:'markup',json:'json',jsonc:'json',md:'markdown',markdown:'markdown',yml:'yaml',yaml:'yaml',sh:'shell',bash:'shell',zsh:'shell',fish:'shell',ps1:'shell',powershell:'shell',dockerfile:'shell',makefile:'shell',env:'shell',css:'css',scss:'css',sass:'css',less:'css',text:'text',txt:'text',plaintext:'text',diff:'diff',patch:'diff'
}
const keywords=Object.fromEntries(Object.entries(keywordLists).map(([language,list])=>[language,new Set(list.split(' '))])) as Record<string,Set<string>>
export function syntaxLanguage(value=''){
 const raw=value.trim().toLowerCase().replace(/^language-/,'').replace(/^\{\.?|\}$/g,'')
 const extension=raw.includes('/')||raw.includes('.')?raw.split(/[/.]/).at(-1)||raw:raw
 return syntaxAliases[extension]||extension||'text'
}
const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const token=(kind:string,value:string)=>value.split('\n').map(line=>`<span class="tok-${kind}">${escapeHtml(line)}</span>`).join('\n')
function markup(code:string){
 const pattern=/(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:-]*)|([\w:-]+)(\s*=\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g
 let html='',last=0
 for(const match of code.matchAll(pattern)){const index=match.index||0;if(index>last)html+=escapeHtml(code.slice(last,index));if(match[1])html+=token('comment',match[1]);else if(match[2])html+=escapeHtml(match[2])+token('tag',match[3]);else html+=token('attr',match[4])+escapeHtml(match[5])+token('string',match[6]);last=index+match[0].length}
 return html+escapeHtml(code.slice(last))
}
function diff(code:string){return code.split('\n').map(line=>line.startsWith('+++')||line.startsWith('---')?token('meta',line):line.startsWith('+')?token('inserted',line):line.startsWith('-')?token('deleted',line):line.startsWith('@@')?token('keyword',line):escapeHtml(line)).join('\n')}
export function highlightCode(code:string,value='text'){
 const language=syntaxLanguage(value)
 if(language==='text'||language==='markdown')return escapeHtml(code)
 if(language==='markup')return markup(code)
 if(language==='diff')return diff(code)
 const words=keywords[language]||new Set<string>(),hashComments=['python','yaml','shell','ruby'].includes(language),sqlComments=language==='sql'
 const comment=hashComments?'#[^\\n]*':sqlComments?'--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/':'\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'
 const pattern=new RegExp(`(${comment})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\u0060(?:\\\\.|[^\u0060\\\\])*\u0060)|(\\b(?:0x[\\da-f]+|0b[01]+|\\d+(?:\\.\\d+)?)\\b)|(\\$[A-Za-z_][\\w]*|\\b[A-Za-z_$][\\w$]*\\b)|([=!<>+\\-*%&|^~?:]+)`,'gi')
 let html='',last=0
 for(const match of code.matchAll(pattern)){
  const index=match.index||0;if(index>last)html+=escapeHtml(code.slice(last,index));const value=match[0];let kind=''
  if(match[1])kind='comment'
  else if(match[2])kind=language==='json'&&/^\s*:/.test(code.slice(index+value.length))?'property':'string'
  else if(match[3])kind='number'
  else if(match[4]){const comparable=language==='sql'?value.toLowerCase():value;if(words.has(comparable))kind='keyword';else if(value.startsWith('$'))kind='variable';else if(/^\s*\(/.test(code.slice(index+value.length)))kind='function';else if(/^[A-Z][\w$]*$/.test(value)&&!['True','False','None'].includes(value))kind='type';else if((language==='css'||language==='yaml')&&/^\s*:/.test(code.slice(index+value.length)))kind='property'}
  else if(match[5])kind='operator'
  html+=kind?token(kind,value):escapeHtml(value);last=index+value.length
 }
 return html+escapeHtml(code.slice(last))
}
