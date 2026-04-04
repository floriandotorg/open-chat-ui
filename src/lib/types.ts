export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  createdAt: Date
}

export interface Conversation {
  id: string
  userId: string
  title: string
  systemPrompt?: string | null
  defaultModel?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ChatStreamEvent {
  type: 'text_delta' | 'usage' | 'done' | 'error'
  text?: string
  inputTokens?: number
  outputTokens?: number
  error?: string
}

export interface ProviderInfo {
  id: string
  name: string
  hasKey: boolean
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
