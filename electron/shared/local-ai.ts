// DeepSeek currently accepts up to 384 Ki tokens. Local runtimes are still
// bounded by their effective context window in inferenceBudget().
export const LOCAL_AI_MAX_OUTPUT_TOKENS = 393216

export type RemoteApiFormat = 'openai' | 'anthropic'

export type LocalAiSettings = {
  apiFormat: RemoteApiFormat
  endpoint: string
  model: string
  maxTokens: number
  hasApiKey: boolean
  hasHfToken: boolean
  downloadDirectory: string
}

export type LocalAiSettingsInput = {
  apiFormat?: RemoteApiFormat
  endpoint?: string
  model?: string
  maxTokens?: number
  apiKey?: string
  clearApiKey?: boolean
  hfToken?: string
  clearHfToken?: boolean
}

export type LocalAiRemoteProfile = {
  id: string
  name: string
  apiFormat: RemoteApiFormat
  endpoint: string
  model: string
  contextLength: number
  hasApiKey: boolean
  updatedAt: string
  lastUsedAt?: string
}

export type LocalAiRemoteProfileInput = {
  id?: string
  name: string
  apiFormat: RemoteApiFormat
  endpoint: string
  model?: string
  contextLength?: number
  apiKey?: string
  clearApiKey?: boolean
}

export type LocalAiSearchResult = {
  id: string
  author: string
  likes: number
  downloads: number
  tags: string[]
  description: string
  pipelineTag?: string
  library?: string
}

export type LocalAiModelFile = {
  file: string
  size: number
  type: string
}

export type LocalAiDownloadEntry = {
  id: string
  repoId: string
  file: string
  localPath: string
  size: number
  downloadedAt: string
}

export type LocalAiChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LocalAiChatPayload = {
  model: string
  messages: LocalAiChatMessage[]
  maxTokens?: number
}
