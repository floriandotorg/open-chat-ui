export interface ImageAttachment {
  id: string
  mimeType: string
  providerFileId?: string
}

export interface FileAttachment {
  id: string
  filename: string
  mimeType: string
  providerFileId?: string
}

export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  textOffset?: number
  result?: string
  rawResult?: string
}

export interface CodeExecutionFile {
  fileId: string
  filename: string
  mimeType: string
}

export interface CodeExecutionBlock {
  id: string
  name: string
  input: Record<string, unknown>
  textOffset?: number
  stdout?: string
  stderr?: string
  returnCode?: number
  error?: string
  files?: CodeExecutionFile[]
}

export interface Message {
  id: string
  conversationId: string
  parentId?: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  thinking?: string
  thinkingDuration?: number
  toolCalls?: ToolCallInfo[]
  codeExecutions?: CodeExecutionBlock[]
  siblingIndex?: number
  siblingCount?: number
  generating?: boolean
  createdAt: Date
  sendError?: string
}

export interface SystemPrompt {
  id: string
  userId: string
  title: string
  content: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ApiKeySummary {
  id: string
  label: string
}

export interface ProviderInfo {
  id: string
  name: string
  hasKey: boolean
  supportsCustomModels?: boolean
  keyCount?: number
  multiple?: boolean
  keys?: ApiKeySummary[]
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow: number
  maxOutputTokens: number
  capabilities: ProviderCapability[]
  inputPricePerMToken?: number
  outputPricePerMToken?: number
}

export type ProviderCapability = 'streaming' | 'vision' | 'tool_use' | 'code_interpreter' | 'file_upload' | 'system_prompt'

export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high' | 'max'

export const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

export interface DailyUsage {
  date: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  requests: number
}

export interface ModelUsage {
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  cost: number
  priced: boolean
}

export interface UsageResponse {
  month: string
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadInputTokens: number
  totalCacheCreationInputTokens: number
  totalRequests: number
  cacheSavings: number
  daily: DailyUsage[]
  models: ModelUsage[]
}
