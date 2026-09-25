import type { StudioDownload, StudioLocalModel, StudioModelFile } from './local-ai-studio.js'

export function modelFileRole(file: string): 'model' | 'projector' | 'shard' {
  const name = file.split(/[\\/]/).at(-1) || file
  if (/^mmproj(?:[-_.].*)?\.gguf$/i.test(name)) return 'projector'
  const split = name.match(/-(\d{5})-of-\d{5}\.gguf$/i)
  return split && split[1] !== '00001' ? 'shard' : 'model'
}

/** A model's first shard and its unique projector form one download choice. */
export function modelDownloadParts(file: StudioModelFile, files: StudioModelFile[]): StudioModelFile[] {
  const split = file.file.match(/^(.*)-\d{5}-of-(\d{5})\.gguf$/i)
  const parts = split ? files.filter(item => {
    const candidate = item.file.match(/^(.*)-\d{5}-of-(\d{5})\.gguf$/i)
    return candidate?.[1] === split[1] && candidate[2] === split[2]
  }) : [file]
  const directory = (name: string) => name.slice(0, name.lastIndexOf('/') + 1)
  const projectors = files.filter(item => modelFileRole(item.file) === 'projector' && directory(item.file) === directory(file.file))
  return modelFileRole(file.file) === 'model' && projectors.length === 1 ? [...parts, projectors[0]] : parts
}

export function modelDownloadState(repoId: string, parts: StudioModelFile[], models: StudioLocalModel[], downloads: StudioDownload[]) {
  const names = new Set(parts.map(part => part.file))
  const tasks = [...downloads].reverse().filter((task, index, rows) => task.repoId === repoId && names.has(task.file) && rows.findIndex(row => row.repoId === repoId && row.file === task.file) === index)
  if (tasks.some(task => ['queued', 'downloading', 'verifying'].includes(task.status))) return 'active'
  const split = parts.find(part => /-00001-of-\d{5}\.gguf$/i.test(part.file))?.file.match(/^(.*)-00001-of-(\d{5})\.gguf$/i)
  const completeCatalog = !split || Array.from({length: Number(split[2])}, (_, i) => `${split[1]}-${String(i + 1).padStart(5, '0')}-of-${split[2]}.gguf`).every(name => names.has(name))
  if (parts.length && completeCatalog && parts.every(part => models.some(model => model.exists && model.repoId === repoId && model.file === part.file))) return 'local'
  if (tasks.some(task => task.status === 'failed')) return 'failed'
  if (tasks.some(task => task.status === 'paused')) return 'paused'
  return 'download'
}
