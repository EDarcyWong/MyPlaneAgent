// Only locally decoded raster images may become CSS backgrounds.
export const MAX_BACKGROUND_LENGTH = 3 * 1024 * 1024
export function validBackgroundImage(value: unknown): value is string {
 return typeof value === 'string' && value.length <= MAX_BACKGROUND_LENGTH && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
}
export function backgroundOpacity(value: unknown): number {
 return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(0.4, value)) : 0.15
}
