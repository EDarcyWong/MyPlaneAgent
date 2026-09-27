import type {ExperienceFailureKind} from '../../../shared/experience.js'
/** Classify runtime errors, never persist their raw text or parameters. */
export function experienceFailure(error:unknown):ExperienceFailureKind{
 const text=String(error instanceof Error?error.name+' '+error.message:typeof error==='string'?error:JSON.stringify(error))
 if(/TimeoutError|timeout|timed.?out|超时|ECONN|ENOTFOUND|EAI_AGAIN|network|offline|fetch failed|网络|HTTP\s*(?:429|5\d\d)/i.test(text))return 'temporary'
 if(/AbortError|cancelled|canceled|取消/i.test(text))return 'cancelled'
 if(/未通过.*校验|坐标或时区无效/.test(text))return 'validation'
 if(/日期需|请提供|定位不唯一|准确匹配/.test(text))return 'input'
 if(/denied|forbidden|拒绝|未授权|permission/i.test(text))return 'denied'
 return 'unavailable'
}
