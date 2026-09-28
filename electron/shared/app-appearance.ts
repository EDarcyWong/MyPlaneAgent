export const appearanceDefaults = {
  accentColor: '', backgroundColor: '', foregroundColor: '',
  fontFamily: 'system', fontSize: 14, codeFontFamily: 'cascadia', codeFontSize: 13,
  codeLineHeight: 1.7, reduceMotion: false,
}
export type AppAppearance = typeof appearanceDefaults
export function normalizeAppearance(value: unknown): AppAppearance {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const color = (key: string) => typeof input[key] === 'string' && /^#[\da-f]{6}$/i.test(input[key] as string) ? (input[key] as string).toLowerCase() : ''
  const number = (key: string, low: number, high: number) => typeof input[key] === 'number' && Number.isFinite(input[key]) ? Math.min(high, Math.max(low, input[key] as number)) : appearanceDefaults[key as keyof AppAppearance] as number
  return {
    accentColor: color('accentColor'), backgroundColor: color('backgroundColor'), foregroundColor: color('foregroundColor'),
    fontFamily: ['system', 'sans', 'serif'].includes(String(input.fontFamily)) ? String(input.fontFamily) : 'system',
    fontSize: Math.round(number('fontSize', 12, 18)),
    codeFontFamily: ['cascadia', 'consolas', 'monospace'].includes(String(input.codeFontFamily)) ? String(input.codeFontFamily) : 'cascadia',
    codeFontSize: Math.round(number('codeFontSize', 11, 22)),
    codeLineHeight: number('codeLineHeight', 1.3, 2.2), reduceMotion: input.reduceMotion === true,
  }
}
export const interfaceFonts: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "PingFang SC", "Microsoft YaHei UI", sans-serif',
  sans: 'Arial, "Microsoft YaHei", sans-serif', serif: 'Georgia, "Noto Serif CJK SC", SimSun, serif',
}
export const codeFonts: Record<string, string> = {
  cascadia: '"Cascadia Code", Consolas, "SFMono-Regular", Menlo, monospace',
  consolas: 'Consolas, "Courier New", monospace', monospace: 'monospace',
}
export function appearanceVariables(value: unknown): Record<string, string> {
  const a = normalizeAppearance(value)
  const css: Record<string, string> = {
    fontFamily: interfaceFonts[a.fontFamily], '--app-font-size': `${a.fontSize}px`,
    '--app-code-font-family': codeFonts[a.codeFontFamily], '--app-code-font-size': `${a.codeFontSize}px`, '--app-code-line-height': String(a.codeLineHeight),
  }
  if (a.accentColor) {
    css['--s-accent'] = a.accentColor
    css['--s-accent-soft'] = `color-mix(in srgb, ${a.accentColor} 12%, var(--s-panel))`
    const channels = [1, 3, 5].map(offset => parseInt(a.accentColor.slice(offset, offset + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    css['--s-on-accent'] = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#111111' : '#ffffff'
  }
  if (a.backgroundColor) {
    css['--s-bg'] = a.backgroundColor
    css['--s-panel'] = `color-mix(in srgb, ${a.backgroundColor} 94%, light-dark(white, black))`
    css['--s-rail'] = `color-mix(in srgb, ${a.backgroundColor} 94%, light-dark(black, white))`
    css['--s-muted'] = `color-mix(in srgb, ${a.backgroundColor} 90%, light-dark(black, white))`
  }
  if (a.foregroundColor) {
    css['--s-text'] = a.foregroundColor
    css['--s-dim'] = `color-mix(in srgb, ${a.foregroundColor} 70%, var(--s-bg))`
  }
  return css
}
