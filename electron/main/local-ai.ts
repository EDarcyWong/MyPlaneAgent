import {createWriteStream, existsSync, mkdirSync, rmSync, statSync} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {createHash, randomUUID} from 'node:crypto'
import {Readable} from 'node:stream'
import path from 'node:path'
import {safeStorage} from 'electron'
import {readIntegrationJson, writeIntegrationJson} from './integration-store.js'
import {LOCAL_AI_MAX_OUTPUT_TOKENS} from '../shared/local-ai.js'
import type {
  LocalAiSettings,
  LocalAiSearchResult,
  LocalAiModelFile,
  LocalAiDownloadEntry,
  LocalAiChatPayload
  ,LocalAiRemoteProfile, LocalAiRemoteProfileInput, RemoteApiFormat
} from '../shared/local-ai.js'

type StoredConfig = {
  apiFormat: RemoteApiFormat
  endpoint: string
  encryptedApiKey: string
  encryptedHfToken: string
  model: string
  maxTokens: number
  downloadDirectory: string
}

type StoredDownload = Omit<LocalAiDownloadEntry, 'id'> & {id?: string}
type StoredRemoteProfile = LocalAiRemoteProfile & {encryptedApiKey: string}

function apiFormat(value: unknown): RemoteApiFormat {
  return value === 'anthropic' ? 'anthropic' : 'openai'
}

function cleanText(value: unknown, name: string, max = 3000) {
  if (typeof value !== 'string') throw new Error(`${name} 无效`)
  const text = value.trim()
  if (!text) throw new Error(`${name} 不能为空`)
  if (text.length > max) throw new Error(`${name} 过长（最大 ${max} 字符）`)
  return text
}

function cleanEndpoint(value: unknown) {
  const text = cleanText(value, '模型服务地址', 500)
  const target = text.endsWith('/') ? text.slice(0, -1) : text
  try {
    const url = new URL(target)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    return target
  } catch {
    throw new Error('模型服务地址必须是 http 或 https')
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

function hash(input: string) {
  return createHash('sha256').update(input).digest('hex')
}

function safeRepo(repoId: string) {
  return repoId.replace(/[^a-zA-Z0-9.\-_\n/]/g, '_')
}

function sanitizeFilename(file: string) {
  return file.replace(/[\\/:*?"<>|]/g, '_')
}

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数格式无效')
  return value as Record<string, unknown>
}

function toText(value: unknown, max = 20000): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.length > max) return text.slice(0, max)
  return text
}

function parseCount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function encodeRepo(repoId: string) {
  return repoId.split('/').map(encodeURIComponent).join('/')
}

function readableFromResponseBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new Error('服务返回了空响应体')
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
}

async function parseJson(response: Response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`响应不是有效的 JSON：${text.slice(0, 400)}`)
  }
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {headers})
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.text()
      detail = body.slice(0, 500)
    } catch {
      /* ignore */
    }
    throw new Error(`HF 请求失败（HTTP ${response.status}）：${detail || '请稍后重试'}`)
  }
  return parseJson(response)
}

function toDisplaySize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return 0
  return bytes
}

function normalizePath(value: string) {
  return value.trim()
}

export class LocalAiService {
  private configFile: string
  private downloadsFile: string
  private profilesFile: string
  constructor(private directory: string) {
    this.configFile = path.join(directory, 'local-ai-settings.json')
    this.downloadsFile = path.join(directory, 'local-ai-downloads.json')
    this.profilesFile = path.join(directory, 'local-ai-remote-profiles.json')
  }

  private canStoreSecure() {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    return typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() !== 'basic_text'
  }

  protected decrypt(value: string) {
    if (!value) return ''
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64')).toString()
    } catch {
      throw new Error('本地密钥解密失败，请重新保存设置')
    }
  }

  protected config() {
    const fallbackDirectory = path.join(this.directory, 'local-ai-models')
    const loaded = readIntegrationJson<StoredConfig>(this.configFile, {
      apiFormat: 'openai',
      endpoint: 'http://127.0.0.1:1234/v1',
      encryptedApiKey: '',
      encryptedHfToken: '',
      model: '',
      maxTokens: 2048,
      downloadDirectory: fallbackDirectory
    })
    if (typeof loaded.endpoint !== 'string' || !loaded.endpoint) loaded.endpoint = 'http://127.0.0.1:1234/v1'
    if (typeof loaded.model !== 'string') loaded.model = ''
    if (typeof loaded.downloadDirectory !== 'string' || !loaded.downloadDirectory.trim()) loaded.downloadDirectory = fallbackDirectory
    loaded.maxTokens = clampInteger(loaded.maxTokens, 128, LOCAL_AI_MAX_OUTPUT_TOKENS, 2048)
    return {
      apiFormat: apiFormat(loaded.apiFormat),
      endpoint: cleanEndpoint(loaded.endpoint),
      model: loaded.model.trim(),
      maxTokens: loaded.maxTokens,
      encryptedApiKey: loaded.encryptedApiKey,
      encryptedHfToken: loaded.encryptedHfToken,
      downloadDirectory: loaded.downloadDirectory
    }
  }

  settings(): LocalAiSettings {
    const current = this.config()
    return {
      apiFormat: current.apiFormat,
      endpoint: current.endpoint,
      model: current.model,
      maxTokens: current.maxTokens,
      hasApiKey: Boolean(current.encryptedApiKey),
      hasHfToken: Boolean(current.encryptedHfToken),
      downloadDirectory: current.downloadDirectory
    }
  }

  protected storedProfiles(): StoredRemoteProfile[] {
    const rows = readIntegrationJson<StoredRemoteProfile[]>(this.profilesFile, [])
    return rows.filter(row => row && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.endpoint === 'string' && typeof row.model === 'string' && typeof row.encryptedApiKey === 'string').map(row => ({...row, apiFormat: apiFormat(row.apiFormat), contextLength: clampInteger(row.contextLength, 512, 1_000_000, 4096)}))
  }

  remoteProfiles(): LocalAiRemoteProfile[] {
    let rows = this.storedProfiles()
    // Migrate the existing single remote configuration into the profile list.
    if (!rows.length) {
      const current = this.config()
      rows = [{id: randomUUID(), name: '当前远程服务', apiFormat: current.apiFormat, endpoint: current.endpoint, model: current.model, contextLength: 4096, encryptedApiKey: current.encryptedApiKey, hasApiKey: Boolean(current.encryptedApiKey), updatedAt: new Date().toISOString(), lastUsedAt: new Date().toISOString()}]
      writeIntegrationJson(this.profilesFile, rows)
    }
    return rows.map(({encryptedApiKey, ...profile}) => ({...profile, hasApiKey: Boolean(encryptedApiKey)}))
  }

  private writeRemoteProfiles(rows: StoredRemoteProfile[]) {
    writeIntegrationJson(this.profilesFile, rows.map(row => ({...row, hasApiKey: Boolean(row.encryptedApiKey)})))
  }

  private saveConfig(current: ReturnType<LocalAiService['config']>) {
    writeIntegrationJson(this.configFile, {
      apiFormat: current.apiFormat, endpoint: current.endpoint, encryptedApiKey: current.encryptedApiKey, encryptedHfToken: current.encryptedHfToken,
      model: current.model, maxTokens: current.maxTokens, downloadDirectory: current.downloadDirectory
    })
  }

  remoteProfileSave(value: unknown): {settings: LocalAiSettings; profiles: LocalAiRemoteProfile[]} {
    const payload = object(value) as unknown as LocalAiRemoteProfileInput
    const name = cleanText(payload.name, '配置名称', 80)
    const format = apiFormat(payload.apiFormat)
    const endpoint = cleanEndpoint(payload.endpoint)
    const model = typeof payload.model === 'string' ? payload.model.trim() : ''
    let rows = this.storedProfiles()
    if (!rows.length) this.remoteProfiles(), rows = this.storedProfiles()
    const existing = payload.id ? rows.find(row => row.id === payload.id) : undefined
    if (payload.id && !existing) throw new Error('远程配置不存在')
    let encryptedApiKey = existing?.encryptedApiKey || ''
    if (payload.clearApiKey === true) encryptedApiKey = ''
    if (typeof payload.apiKey === 'string') {
      const key = payload.apiKey.trim()
      if (!key) encryptedApiKey = ''
      else { if (!this.canStoreSecure()) throw new Error('当前系统安全存储不可用，无法保存 API Key'); encryptedApiKey = safeStorage.encryptString(key).toString('base64') }
    }
    const timestamp = new Date().toISOString()
    const contextLength = clampInteger(payload.contextLength, 512, 1_000_000, existing?.contextLength || 4096)
    const row: StoredRemoteProfile = {id: existing?.id || randomUUID(), name, apiFormat: format, endpoint, model, contextLength, encryptedApiKey, hasApiKey: Boolean(encryptedApiKey), updatedAt: timestamp, lastUsedAt: timestamp}
    rows = existing ? rows.map(item => item.id === row.id ? row : item) : [row, ...rows]
    this.writeRemoteProfiles(rows)
    const current = this.config()
    current.apiFormat = format; current.endpoint = endpoint; current.model = model; current.encryptedApiKey = encryptedApiKey
    this.saveConfig(current)
    return {settings: this.settings(), profiles: this.remoteProfiles()}
  }

  remoteProfileUse(id: string): {settings: LocalAiSettings; profiles: LocalAiRemoteProfile[]} {
    const rows = this.storedProfiles(), selected = rows.find(row => row.id === id)
    if (!selected) throw new Error('远程配置不存在')
    const timestamp = new Date().toISOString()
    this.writeRemoteProfiles(rows.map(row => row.id === id ? {...row, lastUsedAt: timestamp} : row))
    const current = this.config(); current.apiFormat = apiFormat(selected.apiFormat); current.endpoint = selected.endpoint; current.model = selected.model; current.encryptedApiKey = selected.encryptedApiKey; this.saveConfig(current)
    return {settings: this.settings(), profiles: this.remoteProfiles()}
  }

  remoteProfileDelete(id: string): LocalAiRemoteProfile[] {
    const rows = this.storedProfiles()
    if (!rows.some(row => row.id === id)) throw new Error('远程配置不存在')
    const remaining = rows.filter(row => row.id !== id)
    this.writeRemoteProfiles(remaining)
    return remaining.map(({encryptedApiKey, ...profile}) => ({...profile, hasApiKey: Boolean(encryptedApiKey)}))
  }

  saveSettings(value: unknown): LocalAiSettings {
    const payload = object(value)
    const current = this.config()
    if (payload.apiFormat !== undefined) current.apiFormat = apiFormat(payload.apiFormat)
    if (payload.endpoint !== undefined) {
      const next = cleanEndpoint(payload.endpoint)
      if (next !== current.endpoint) current.encryptedApiKey = ''
      current.endpoint = next
    }
    if (payload.model !== undefined && typeof payload.model === 'string') current.model = payload.model.trim()
    if (payload.maxTokens !== undefined) current.maxTokens = clampInteger(payload.maxTokens, 128, LOCAL_AI_MAX_OUTPUT_TOKENS, current.maxTokens)
    if (payload.clearApiKey === true) current.encryptedApiKey = ''
    if (typeof payload.apiKey === 'string') {
      const key = payload.apiKey.trim()
      if (!key) current.encryptedApiKey = ''
      else {
        if (!this.canStoreSecure()) throw new Error('当前系统安全存储不可用，无法保存 API Key')
        current.encryptedApiKey = safeStorage.encryptString(key).toString('base64')
      }
    }
    if (payload.clearHfToken === true) current.encryptedHfToken = ''
    if (typeof payload.hfToken === 'string') {
      const token = payload.hfToken.trim()
      if (!token) current.encryptedHfToken = ''
      else {
        if (!this.canStoreSecure()) throw new Error('当前系统安全存储不可用，无法保存 Hugging Face Token')
        current.encryptedHfToken = safeStorage.encryptString(token).toString('base64')
      }
    }
    if (payload.downloadDirectory !== undefined) {
      const directory = normalizePath(cleanText(payload.downloadDirectory, '下载目录', 260))
      if (!directory) throw new Error('下载目录不能为空')
      current.downloadDirectory = directory
    }
    this.saveConfig(current)
    if (payload.apiFormat !== undefined || payload.endpoint !== undefined || payload.model !== undefined || payload.contextLength !== undefined || payload.apiKey !== undefined || payload.clearApiKey === true) {
      const rows = this.storedProfiles()
      if (rows.length) {
        const timestamp = new Date().toISOString()
        const active = rows.find(row => row.apiFormat === current.apiFormat && row.endpoint === current.endpoint) || rows[0]
        const contextLength = clampInteger(payload.contextLength, 512, 1_000_000, active.contextLength)
        this.writeRemoteProfiles(rows.map(row => row.id === active.id ? {...row, apiFormat: current.apiFormat, endpoint: current.endpoint, model: current.model, contextLength, encryptedApiKey: current.encryptedApiKey, hasApiKey: Boolean(current.encryptedApiKey), updatedAt: timestamp, lastUsedAt: timestamp} : row))
      }
    }
    return this.settings()
  }

  protected hfHeaders(): Record<string, string> {
    const current = this.config()
    const headers: Record<string, string> = {Accept: 'application/json'}
    if (current.encryptedHfToken) headers.Authorization = `Bearer ${this.decrypt(current.encryptedHfToken)}`
    return headers
  }

  protected normalizeDownloadDirectory() {
    const value = this.config().downloadDirectory
    mkdirSync(value, {recursive: true})
    return value
  }

  protected readDownloads(): LocalAiDownloadEntry[] {
    const rows = readIntegrationJson<StoredDownload[]>(this.downloadsFile, [])
    return rows
      .filter(entry =>
        typeof entry.repoId === 'string' &&
        entry.repoId.trim() &&
        typeof entry.file === 'string' &&
        entry.file.trim() &&
        typeof entry.localPath === 'string' &&
        entry.localPath.trim() &&
        typeof entry.size === 'number' &&
        Number.isFinite(entry.size)
      )
      .map(entry => ({
        ...entry,
        id: entry.id?.trim() || hash(`${entry.repoId}|${entry.file}|${entry.localPath}`)
      }))
  }

  protected saveDownloads(rows: StoredDownload[]) {
    writeIntegrationJson(this.downloadsFile, rows)
  }

  private pruneDownloads(rows: LocalAiDownloadEntry[]) {
    const repaired = rows.filter(entry => {
      if (!existsSync(entry.localPath)) return false
      try {
        return statSync(entry.localPath).isFile()
      } catch {
        return false
      }
    })
    if (repaired.length !== rows.length) this.saveDownloads(repaired)
    return repaired
  }

  listDownloads(): LocalAiDownloadEntry[] {
    const rows = this.pruneDownloads(this.readDownloads()).sort((a, b) =>
      a.downloadedAt < b.downloadedAt ? 1 : -1
    )
    return rows
  }

  async searchModels(query: string): Promise<LocalAiSearchResult[]> {
    const text = cleanText(query, '搜索关键字', 120)
    const params = new URLSearchParams({
      sort: 'downloads',
      direction: '-1',
      limit: '20',
      full: 'true'
    })
    if (text) params.set('search', text)
    const models = await fetchJson(`https://huggingface.co/api/models?${params}`, this.hfHeaders())
    if (!Array.isArray(models)) throw new Error('Hugging Face 返回了异常数据')
    return models.slice(0, 20).map(item => ({
      id: String(item.id ?? '').trim(),
      author: String(item.author ?? '').trim(),
      likes: parseCount(item.likes),
      downloads: parseCount(item.downloads),
      tags: Array.isArray(item.tags) ? (item.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string').slice(0, 16) : [],
      description: String(item.cardData?.language || item.modelId || '').slice(0, 200) || '无简介',
      pipelineTag: typeof item.pipeline_tag === 'string' ? item.pipeline_tag : undefined,
      library: typeof item.library_name === 'string' ? item.library_name : undefined
    })).filter(item => item.id)
  }

  async modelFiles(repoId: string): Promise<LocalAiModelFile[]> {
    const model = cleanText(repoId, '模型 ID', 300)
    const json = await fetchJson(`https://huggingface.co/api/models/${encodeRepo(model)}`, this.hfHeaders())
    const siblings: Record<string, unknown>[] = Array.isArray(json?.siblings) ? json.siblings : []
    const files = siblings.map((item: Record<string, unknown>) => ({
      file: typeof item.rfilename === 'string' ? item.rfilename : '',
      size: typeof item.size === 'number' ? item.size : Number((item as {lfs?: {size?: number}}).lfs?.size),
      type: String(item.type ?? 'file')
    })).filter(file => file.file && !file.file.startsWith('.') && /[^/\\]/.test(file.file))
    if (!files.length) return []
    return files.map(entry => ({
      file: entry.file,
      size: toDisplaySize(Number(entry.size) || 0),
      type: String(entry.type)
    }))
  }

  async downloadModel(repoId: string, file: string): Promise<LocalAiDownloadEntry> {
    const safeRepoId = cleanText(repoId, '模型 ID', 300)
    if (!safeRepoId.includes('/')) throw new Error('模型 ID 应包含仓库路径，如 org/model')
    const safeFile = sanitizeFilename(cleanText(file, '模型文件名', 500))
    const downloadDirectory = this.normalizeDownloadDirectory()
    const targetFolder = path.join(downloadDirectory, safeRepo(safeRepoId))
    mkdirSync(targetFolder, {recursive: true})
    let outputPath = path.join(targetFolder, safeFile)
    if (existsSync(outputPath)) {
      const ext = path.extname(safeFile)
      const base = path.basename(safeFile, ext)
      outputPath = path.join(targetFolder, `${base}-${Date.now()}${ext}`)
    }
    const url = `https://huggingface.co/${encodeRepo(safeRepoId)}/resolve/main/${encodeURIComponent(safeFile)}`
    const headers = this.hfHeaders()
    const response = await fetch(url, {headers})
    if (!response.ok) throw new Error(`模型文件下载失败（HTTP ${response.status}）`)
    const writer = createWriteStream(outputPath)
    await pipeline(readableFromResponseBody(response.body), writer)
    const info = statSync(outputPath)
    const downloads = this.readDownloads()
    const now = new Date().toISOString()
    const entry: LocalAiDownloadEntry = {
      id: randomUUID(),
      repoId: safeRepoId,
      file: safeFile,
      localPath: outputPath,
      size: toDisplaySize(info.size),
      downloadedAt: now
    }
    const merged = [entry, ...downloads.filter(item => item.repoId !== entry.repoId || item.file !== entry.file)]
    this.saveDownloads(merged)
    return entry
  }

  async deleteModel(id: string): Promise<void> {
    const rows = this.readDownloads()
    const target = rows.find(item => item.id === id)
    if (!target) throw new Error('未找到该模型记录')
    const removed = rows.filter(item => item.id !== id)
    if (existsSync(target.localPath)) rmSync(target.localPath)
    this.saveDownloads(removed)
  }

  async chat(payload: LocalAiChatPayload): Promise<string> {
    const settings = this.config()
    const body = object(payload as LocalAiChatPayload)
    const model = cleanText(body.model || settings.model, '模型', 250)
    const messages = Array.isArray(body.messages) ? body.messages : []
    const normalizedMessages = messages
      .map(item => {
        if (!item || typeof item.role !== 'string' || !['system', 'user', 'assistant'].includes(item.role)) return null
        const content = toText(item.content)
        if (!content) return null
        return {role: item.role as 'system' | 'user' | 'assistant', content}
      })
      .filter(Boolean) as Array<{role: 'system' | 'user' | 'assistant'; content: string}>

    if (!normalizedMessages.length) throw new Error('请先输入对话内容')
    const maxTokens = clampInteger(body.maxTokens, 128, LOCAL_AI_MAX_OUTPUT_TOKENS, settings.maxTokens)
    const response = await fetch(`${settings.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...((settings.encryptedApiKey ? {Authorization: `Bearer ${this.decrypt(settings.encryptedApiKey)}`} : {}))
      },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        max_tokens: maxTokens,
        stream: false
      })
    })
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`本地 AI 服务失败（HTTP ${response.status}）：${error.slice(0, 400)}`)
    }
    const result = await parseJson(response)
    const message = result?.choices?.[0]?.message?.content ?? result?.choices?.[0]?.message?.text ?? result?.choices?.[0]?.text ?? ''
    if (typeof message !== 'string' || !message.trim()) throw new Error('模型返回了空内容')
    return message.trim()
  }
}
