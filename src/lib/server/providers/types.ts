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

export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: ChatMessageImage[]
  toolCalls?: ToolCallInfo[]
  toolCallId?: string
}

export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  thinkingEffort?: 'none' | 'low' | 'medium' | 'high' | 'max'
  signal?: AbortSignal
  tools?: ToolSchema[]
}

export interface ChatStreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'usage' | 'done' | 'error' | 'tool_call' | 'tool_result'
  text?: string
  thinking?: string
  inputTokens?: number
  outputTokens?: number
  error?: string
  toolCall?: ToolCallInfo
  toolResult?: { toolCallId: string; toolName: string; result: string }
  stopReason?: 'end' | 'tool_use'
}

export interface LLMProvider {
  readonly id: string
  readonly name: string
  readonly capabilities: ProviderCapability[]

  listModels(): Promise<ModelInfo[]>
  chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent>
}

export type ProviderFactory = (apiKey: string) => LLMProvider
