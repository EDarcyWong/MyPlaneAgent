export const backgroundPresets = [
 { id: 'silver-horizon', name: '银白光纤', theme: '素白', group: '科技光影', file: 'silver-horizon.png' },
 { id: 'ocean-signal', name: '深海流光', theme: '晴海', group: '科技光影', file: 'ocean-signal.png' },
 { id: 'amber-orbit', name: '暖金曲面', theme: '暖砂', group: '科技光影', file: 'amber-orbit.png' },
 { id: 'jade-aurora', name: '青绿极光', theme: '青岚', group: '科技光影', file: 'jade-aurora.png' },
 { id: 'ink-plum', name: '梅 · 疏影', theme: '疏枝淡墨', group: '中国水墨', file: 'ink-plum.png' },
 { id: 'ink-orchid', name: '兰 · 幽香', theme: '空谷清韵', group: '中国水墨', file: 'ink-orchid.png' },
 { id: 'ink-bamboo', name: '竹 · 清风', theme: '竹影入画', group: '中国水墨', file: 'ink-bamboo.png' },
 { id: 'ink-chrysanthemum', name: '菊 · 秋韵', theme: '淡雅秋意', group: '中国水墨', file: 'ink-chrysanthemum.png' },
] as const
export function backgroundPreset(value: unknown) {
 return backgroundPresets.find(item => value === `builtin:${item.id}`)
}
// Accept only bundled presets or locally decoded raster images.
export const MAX_BACKGROUND_LENGTH = 3 * 1024 * 1024
export function validBackgroundImage(value: unknown): value is string {
 return typeof value === 'string' && (!!backgroundPreset(value) || (value.length <= MAX_BACKGROUND_LENGTH && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)))
}
export function backgroundOpacity(value: unknown): number {
 return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(0.4, value)) : 0.15
}
