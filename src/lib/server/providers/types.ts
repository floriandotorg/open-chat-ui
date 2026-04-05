export type ProviderCapability = 'streaming' | 'vision' | 'tool_use' | 'code_interpreter' | 'file_upload' | 'system_prompt'

export interface ModelInfo {
  id: string
  name: string
  contextWindow: number
  maxOutputTokens: number
  capabilities: ProviderCapability[]
  inputPricePerMToken?: number
  outputPricePerMToken?: number
}

export interface ChatMessageImage {
  data: string
  mimeType: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: ChatMessageImage[]
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  thinkingEffort?: 'none' | 'low' | 'medium' | 'high' | 'max'
  signal?: AbortSignal
}

export interface ChatStreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'usage' | 'done' | 'error'
  text?: string
  thinking?: string
  inputTokens?: number
  outputTokens?: number
  error?: string
}

export interface LLMProvider {
  readonly id: string
  readonly name: string
  readonly capabilities: ProviderCapability[]

  listModels(): Promise<ModelInfo[]>
  chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent>
}

export type ProviderFactory = (apiKey: string) => LLMProvider
