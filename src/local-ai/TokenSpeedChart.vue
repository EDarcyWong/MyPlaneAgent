<script setup lang="ts">
import { computed } from 'vue'
import type { ModelTokenSample } from '../../electron/shared/model-performance'

const props = defineProps<{ sample: ModelTokenSample; now: number; metric: 'inputRate' | 'outputRate'; label: string }>()
const end = computed(() => props.sample.phase === 'finished' ? props.sample.updatedAt : Math.max(props.now, props.sample.updatedAt))
const points = computed(() => (props.sample.history || []).flatMap(point => {
  const value = point[props.metric]
  return value !== undefined && Number.isFinite(value) && value >= 0 && point.at >= end.value - 60000 && point.at <= end.value
    ? [{ at: point.at, value }] : []
}))
const ceiling = computed(() => {
  const maximum = Math.max(1, ...points.value.map(point => point.value))
  const step = 10 ** Math.floor(Math.log10(maximum))
  return Math.ceil(maximum / step) * step
})
const groups = computed(() => {
  const result: { x: number; y: number }[][] = []
  let previous = -Infinity
  for (const point of points.value) {
    // A missing report is a gap, not zero throughput or a repeated old value.
    if (point.at - previous > 10000) result.push([])
    result.at(-1)!.push({ x: 1 + (point.at - end.value + 60000) / 60000 * 238, y: 89 - point.value / ceiling.value * 88 })
    previous = point.at
  }
  return result.map(group => ({
    line: group.map(point => `${point.x},${point.y}`).join(' '),
    area: `${group[0].x},89 ${group.map(point => `${point.x},${point.y}`).join(' ')} ${group.at(-1)!.x},89`,
    points: group,
  }))
})
</script>

<template>
  <figure class="speed-chart">
    <figcaption><span>{{ label }}</span><small>{{ ceiling }} tok/s</small></figcaption>
    <div class="plot">
      <svg viewBox="0 0 240 90" preserveAspectRatio="none" role="img" :aria-label="`${label}，最近 60 秒，${points.length} 个采样点，上限 ${ceiling} tok/s`">
        <path class="grid" d="M1 1H239V89H1Z M1 23H239 M1 45H239 M1 67H239 M40 1V89 M80 1V89 M120 1V89 M160 1V89 M200 1V89"/>
        <g v-for="(group,index) in groups" :key="index">
          <polygon v-if="group.points.length>1" class="area" :points="group.area"/>
          <polyline v-if="group.points.length>1" class="line" :points="group.line"/>
          <circle v-for="(point,i) in group.points" :key="i" :cx="point.x" :cy="point.y" r="1.5" class="dot"/>
        </g>
      </svg>
      <span v-if="!points.length" class="no-data">暂无采样</span>
    </div>
    <div class="axis"><span>60 秒前</span><span>{{ sample.phase==='finished'?'结束时':'现在' }}</span></div>
  </figure>
</template>

<style scoped>
.speed-chart{margin:0;min-width:0}figcaption{display:flex;align-items:center;justify-content:space-between;gap:5px;font-size:11px;margin-bottom:6px}figcaption small{font-size:10px;color:var(--s-dim)}.plot{height:90px;position:relative;background:var(--s-bg)}svg{display:block;width:100%;height:100%;overflow:visible}.grid{stroke:var(--s-border);stroke-width:.7;fill:none;vector-effect:non-scaling-stroke}.line{stroke:var(--s-accent);stroke-width:1.2;fill:none;vector-effect:non-scaling-stroke}.area{fill:var(--s-accent);opacity:.09}.dot{fill:var(--s-accent)}.axis{display:flex;justify-content:space-between;color:var(--s-dim);font-size:9px;margin-top:4px}.no-data{position:absolute;inset:0;display:grid;place-items:center;color:var(--s-dim);font-size:10px}
</style>
