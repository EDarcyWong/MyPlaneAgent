/** Local server timings or explicitly labelled external request throughput. */
export type ModelTokenSample = {
  source?: 'external'
  model?: string
  tokenBasis?: 'usage' | 'estimated'
  startedAt?: number
  firstOutputMs?: number
  elapsedMs?: number
  outcome?: 'complete' | 'error' | 'cancelled'
  history?: { at: number; inputRate?: number; outputRate?: number }[]
  slot: number
  task: number
  phase: 'processing' | 'generating' | 'finished'
  updatedAt: number
  inputTokens?: number
  outputTokens?: number
  inputRate?: number
  outputRate?: number
  recentOutputRate?: number
  inputMs?: number
  outputMs?: number
}
