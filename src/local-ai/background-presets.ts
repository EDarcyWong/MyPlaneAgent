import {backgroundPreset,validBackgroundImage} from '../../electron/shared/app-background'

export function backgroundImageUrl(value: unknown): string {
 const preset = backgroundPreset(value)
 if (preset) return new URL(`backgrounds/${preset.file}`, document.baseURI).href
 return validBackgroundImage(value) ? value : ''
}
