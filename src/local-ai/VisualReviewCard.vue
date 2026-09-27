<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ElDialog} from 'element-plus'
import type {TaskItem} from '../../electron/shared/task-plan'
import type {StudioMessage} from '../../electron/shared/local-ai-studio'
import {visualReviewCard,type VisualDecision} from '../../electron/shared/visual-review'
const props=defineProps<{item:TaskItem;messages:StudioMessage[];disabled:boolean}>()
const emit=defineEmits<{decide:[value:VisualDecision];open:[url:string]}>()
const card=computed(()=>visualReviewCard(props.item,props.messages))
const enlarged=ref(false),note=ref('')
watch(()=>card.value?.activityId,()=>{enlarged.value=false;note.value=''})
function decide(decision:VisualDecision['decision']){
 if(props.disabled||!card.value)return
 emit('decide',{itemId:props.item.id,activityId:card.value.activityId,imageHash:card.value.imageHash,decision,...(note.value.trim()?{note:note.value.trim()}:{})})
}
</script>
<template>
 <section v-if="card" class="visual-review" aria-label="视觉验收">
  <header><strong>待你确认 · {{card.title}}</strong><span>只确认画面，其余条件由应用继续核验</span></header>
  <div class="review-body">
  <p>{{card.question}}</p>
  <button v-if="card.image" type="button" class="preview" aria-label="放大验收截图" @click="enlarged=true"><img :src="card.image.dataUrl" :alt="'验收截图：'+card.title"/><span>点击放大</span></button>
  <p v-else class="hint">尚无可查看的截图，请先获取画面。</p>
  <p v-if="card.stale" class="hint">截图后页面或文件已有操作，这张图可能已过期，请重新截图。</p>
  <p v-if="card.responded" class="hint">这张截图已提交过结果。如需再次验收，请获取新截图。</p>
  <details class="feedback"><summary>补充说明（选填）</summary><textarea v-model="note" :disabled="disabled" maxlength="1000" rows="2" placeholder="例如：门框横梁上方仍然是不透明墙面"/></details>
  </div>
  <footer><button type="button" class="primary" :disabled="disabled||!card.canAccept" @click="decide('accept')">符合要求</button><button type="button" :disabled="disabled||!card.canAccept" @click="decide('reject')">仍有问题</button><button type="button" :disabled="disabled" @click="decide('recapture')">{{card.image?'看不清，重新截图':'获取截图'}}</button></footer>
  <div class="links"><button v-if="/^https?:\/\//i.test(card.url)" type="button" :disabled="disabled" @click="emit('open',card.url)">查看现场页面</button><details><summary>技术详情</summary><dl><dt>页面地址</dt><dd>{{card.url||'未记录'}}</dd><dt>截图时间</dt><dd>{{card.capturedAt||'未记录'}}</dd><dt>图片哈希</dt><dd>{{card.imageHash||'未记录'}}</dd><dt>任务 ID</dt><dd>{{card.itemId}}</dd></dl></details></div>
  <ElDialog v-model="enlarged" title="查看验收截图" width="min(1200px, 95vw)" append-to-body><img v-if="card.image" class="enlarged" :src="card.image.dataUrl" :alt="card.title"/></ElDialog>
 </section>
</template>
<style scoped>
.visual-review{padding:14px;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel);font-size:13px;margin-bottom:10px;color:var(--s-text)}header{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between}header span,.hint{color:var(--s-dim);font-size:12px}p{line-height:1.6}.preview{display:block;position:relative;width:min(280px,100%);height:158px;padding:0;overflow:hidden;background:var(--s-muted)}.preview img{display:block;width:100%;height:100%;object-fit:contain;margin:auto}.preview span{position:absolute;bottom:6px;right:8px;padding:3px 7px;border-radius:4px;background:#000a;color:white}.enlarged{display:block;max-width:100%;max-height:75vh;object-fit:contain;margin:auto}.review-body{max-height:30vh;overflow:auto;margin:8px 0;padding-right:4px}.feedback{margin:8px 0}.links details{max-width:100%;max-height:120px;overflow:auto}textarea{display:block;box-sizing:border-box;width:100%;margin-top:5px;padding:8px;background:var(--s-bg);color:var(--s-text);border:1px solid var(--s-border);border-radius:6px;resize:vertical;font:inherit}footer,.links{display:flex;gap:8px;flex-wrap:wrap;align-items:start}button{cursor:pointer;padding:7px 12px;border:1px solid var(--s-border);border-radius:7px;background:var(--s-panel);color:var(--s-text);font:inherit}button:disabled{opacity:.45;cursor:default}.primary{background:var(--s-accent);color:var(--s-on-accent)}.links{margin-top:10px;font-size:12px}.links button{padding:0;border:0;color:var(--s-accent)}summary{cursor:pointer}dd{margin:3px 0 8px;overflow-wrap:anywhere;color:var(--s-dim)}
</style>
