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

export interface Citation {
  index: number
  url: string
  title: string
  hostname: string
}

export interface CodeExecutionFile {
  fileId: string
  filename: string
  mimeType: string
}

export type StreamOp =
  | { t: 'text'; v: string }
  | { t: 'thinking'; v: string }
  | { t: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; textOffset: number }
  | { t: 'tool_result'; id: string; resultChars: number; citations?: Citation[] }
  | { t: 'code_exec_start'; id: string; name: string; textOffset: number }
  | { t: 'code_exec_input'; id: string; input: Record<string, unknown> }
  | { t: 'code_exec_result'; id: string; returnCode?: number; error?: string; stdoutChars: number; stderrChars: number }
  | { t: 'code_exec_files'; id: string; files: CodeExecutionFile[] }

export interface StreamEvent {
  messageId: string
  seq: number
  ops: StreamOp[]
}

// result/rawResult only exist on unmigrated legacy rows; new writes move them
// to message_payloads.
export interface ToolCallSummary {
  id: string
  name: string
  arguments: Record<string, unknown>
  textOffset: number
  done: boolean
  resultChars?: number
  citations?: Citation[]
  result?: string
  rawResult?: string
}

// stdout/stderr only exist on unmigrated legacy rows.
export interface CodeExecutionSummary {
  type: 'code_execution'
  id: string
  name: string
  input: Record<string, unknown>
  textOffset: number
  done: boolean
  returnCode?: number
  error?: string
  stdoutChars?: number
  stderrChars?: number
  files?: CodeExecutionFile[]
  stdout?: string
  stderr?: string
}

export interface MessagePayload {
  messageId: string
  toolResults: Record<string, { result?: string; rawResult?: string; stdout?: string; stderr?: string }>
  rawContentBlocks: { textOffset: number; blocks: unknown[] }[] | null
  thinking: string | null
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
  toolCalls?: ToolCallSummary[]
  codeExecutions?: CodeExecutionSummary[]
  eventSeq?: number
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
