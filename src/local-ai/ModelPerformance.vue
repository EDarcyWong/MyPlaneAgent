<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Minus, Odometer, Close, ArrowDown, ArrowUp, TopRight } from '@element-plus/icons-vue'
import TokenSpeedChart from './TokenSpeedChart.vue'
import type { StudioRuntime } from '../../electron/shared/local-ai-studio'

const props = defineProps<{ runtime?: StudioRuntime; source: 'managed' | 'external'; modelLabel?: string; detached?: boolean }>()
const emit = defineEmits<{ close: []; detach: [] }>()
const collapsed = ref(false), now = ref(Date.now())
const showCharts = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const samples = computed(() => props.source === 'external' ? props.runtime?.externalPerformance||[] : props.runtime?.state === 'running' ? props.runtime.performance || [] : [])
const unavailable = computed(() => props.source === 'external' ? '等待外部模型请求（OpenAI / Anthropic 兼容接口）' : props.runtime?.state === 'starting' ? '模型加载中' : props.runtime?.state !== 'running' ? '本地模型未运行' : props.runtime.embedding ? '向量模式暂无生成速度' : '等待服务上报 Token 统计')
const rate = (value?: number) => value === undefined ? '—' : value.toFixed(1)
const age = (timestamp: number) => Math.max(0, Math.floor((now.value - timestamp) / 1000))
</script>

<template>
  <aside class="model-performance" :class="{collapsed, detached, 'with-charts':showCharts&&!collapsed}" aria-label="模型性能小窗">
    <header v-if="!detached"><Odometer aria-hidden="true"/><strong>Token 速度</strong><button type="button" aria-label="在独立窗口打开性能小窗" title="脱离主窗体，可自由拖动和缩放" @click="emit('detach')"><TopRight/></button><button type="button" :aria-label="collapsed?'展开模型性能':'收起模型性能'" :aria-expanded="!collapsed" @click="collapsed=!collapsed"><span v-if="collapsed">展开</span><Minus v-else/></button><button type="button" aria-label="关闭模型性能小窗" title="本次关闭，可在设置中重新开启" @click="emit('close')"><Close/></button></header>
    <template v-if="!collapsed">
      <div class="performance-toolbar">
      <p class="model-name" :title="modelLabel || runtime?.modelName">{{ source==='managed' ? modelLabel || runtime?.modelName || '本地模型' : '外部模型' }}</p>
      <button type="button" class="chart-toggle" :aria-expanded="showCharts" :aria-controls="samples.length?'token-performance-samples':undefined" @click="showCharts=!showCharts"><component :is="showCharts?ArrowUp:ArrowDown" aria-hidden="true"/>{{ showCharts?'隐藏图表':'展开图表' }}</button>
      </div>
      <div v-if="!samples.length" class="empty" role="status">{{ unavailable }}</div>
      <div v-else id="token-performance-samples" class="samples">
        <section v-for="sample in samples" :key="`${sample.slot}:${sample.task}`" class="sample">
          <div class="sample-heading"><span>{{ sample.outcome==='error'?'请求失败':sample.outcome==='cancelled'?'已取消':sample.phase==='finished'?'已结束 · 本次均值':sample.phase==='generating'?'正在生成':'正在处理 · 等待生成统计' }}</span><small>{{ sample.source==='external'?'请求':'槽 '+(sample.slot+1) }} · #{{ sample.task }}</small></div>
          <p v-if="sample.source==='external'" class="counts">{{ sample.model }} · {{ sample.tokenBasis==='usage'?'服务端 Token 用量':'Token 粗估' }}</p>
          <dl><div><dt>{{ sample.source==='external'?'输入用量':'输入处理' }}</dt><dd>{{ sample.source==='external'?(sample.inputTokens?.toLocaleString()??'—'):rate(sample.inputRate) }} <small>{{ sample.source==='external'?'token':'tok/s' }}</small></dd></div><div><dt>{{ sample.source==='external'?'请求平均输出吞吐':'输出生成均值' }}</dt><dd>{{ sample.tokenBasis==='estimated'?'≈ ':'' }}{{ rate(sample.outputRate) }} <small>tok/s</small></dd></div></dl>
          <p v-if="sample.source==='external'" class="recent">耗时 {{ ((sample.elapsedMs||0)/1000).toFixed(1) }} 秒 · 首段输出 {{ sample.firstOutputMs===undefined?'—':(sample.firstOutputMs/1000).toFixed(2)+' 秒' }}</p>
          <p v-else-if="sample.phase!=='finished'" class="recent">最近 3 秒生成：<b>{{ rate(sample.recentOutputRate) }}</b> tok/s</p>
          <div v-if="showCharts" class="speed-charts" aria-label="Token 速度趋势图">
            <TokenSpeedChart v-if="sample.source!=='external'" :sample="sample" :now="now" metric="inputRate" label="输入处理均值"/>
            <TokenSpeedChart :style="sample.source==='external'?{gridColumn:'1 / -1'}:undefined" :sample="sample" :now="now" metric="outputRate" :label="sample.source==='external'?'请求平均输出吞吐（过程粗估）':'输出生成均值'"/>
            <p>最近 60 秒 · 独立纵轴 · 超过 10 秒未上报处留空</p>
          </div>
          <p class="counts">{{ sample.source==='external'?'本次用量':'本次处理' }} {{ sample.inputTokens?.toLocaleString() ?? '—' }} 输入 / {{ sample.tokenBasis==='estimated'?'≈ ':'' }}{{ sample.outputTokens?.toLocaleString() ?? '—' }} 输出 token</p>
          <p class="updated">{{ age(sample.updatedAt) }} 秒前{{ sample.source==='external'?'更新':'上报' }}<span v-if="sample.phase!=='finished' && age(sample.updatedAt)>10"> · 等待新统计</span></p>
        </section>
      </div>
      <footer v-if="source==='external'">输出 token ÷ 请求总耗时（含网络、排队及首段等待），非服务端纯生成速度。流式阶段按 4 字符/token 粗估，含思考和工具参数；结束后以服务端 usage 校正，未返回 usage 则保留粗估。输入处理速度无法测得，“—”表示未上报。</footer>
      <footer v-else>服务端实测 · 随日志更新<br/>输入为本次处理量；“—”表示尚未上报。</footer>
    </template>
  </aside>
</template>

<style scoped>
.model-performance{position:fixed;z-index:40;right:18px;top:80px;width:min(300px,calc(100vw - 36px));border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel);color:var(--s-text);box-shadow:0 8px 28px #0002;font-size:12px;overflow:hidden}.model-performance.collapsed{width:210px}header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--s-muted)}header strong{flex:1;font-weight:600}svg{width:16px;height:16px;flex:none}button{display:grid;place-items:center;min-width:26px;min-height:26px;padding:3px;border:0;border-radius:5px;background:transparent;color:var(--s-dim);font:inherit;cursor:pointer}button:hover{background:var(--s-bg);color:var(--s-text)}button:focus-visible{outline:2px solid var(--s-accent);outline-offset:1px}.model-name{margin:10px 12px;color:var(--s-dim);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.samples{max-height:min(420px,calc(100vh - 250px));overflow:auto}.sample{padding:10px 12px;border-top:1px solid var(--s-border)}.sample-heading{display:flex;justify-content:space-between;gap:8px;font-size:11px}.sample-heading>span{color:var(--s-accent)}.sample-heading small{color:var(--s-dim);white-space:nowrap}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 10px}dt{color:var(--s-dim);font-size:11px}dd{margin:4px 0 0;font-size:24px;font-variant-numeric:tabular-nums}dd small{font-size:10px;color:var(--s-dim)}.recent{margin:7px 0;font-size:11px}.counts,.updated{font-size:10px;color:var(--s-dim);margin:5px 0;line-height:1.6}footer{padding:9px 12px;border-top:1px solid var(--s-border);color:var(--s-dim);font-size:10px;line-height:1.6}.empty{padding:14px 12px;color:var(--s-dim)}
</style>

<style scoped>
.performance-toolbar{flex:none;min-width:0}.detached .performance-toolbar{display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--s-panel)}.detached .performance-toolbar .model-name{flex:1;min-width:0;margin:0;font-size:11px}.detached .performance-toolbar .chart-toggle{flex:none;align-self:auto;margin:0;white-space:nowrap;border:1px solid var(--s-border);padding:5px 8px;border-radius:6px}.detached .sample{padding:14px}.detached footer{padding:8px 14px}
</style>

<style scoped>
.model-performance.with-charts{width:min(380px,calc(100vw - 36px))}.chart-toggle{display:flex;gap:5px;margin:0 10px 8px;padding:4px 6px;font-size:11px;color:var(--s-accent)}.chart-toggle svg{width:12px;height:12px}.speed-charts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 10px}.speed-charts>p{grid-column:1/-1;font-size:9px;color:var(--s-dim);margin:0;line-height:1.5}.samples{max-height:min(420px,calc(100vh - 290px))}
.model-performance.detached{position:static;width:100%;height:100%;box-sizing:border-box;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column;min-height:0}.detached .samples{flex:1;min-height:0;max-height:none;overflow:auto}.detached header,.detached footer,.detached .model-name,.detached .chart-toggle{flex:none}.detached .chart-toggle{align-self:flex-start}.detached.collapsed{height:auto}.detached .empty{flex:1}.detached .speed-charts{gap:16px}
</style>
