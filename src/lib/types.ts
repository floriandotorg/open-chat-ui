export interface ImageAttachment {
  id: string
  mimeType: string
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
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  thinking?: string
  thinkingDuration?: number
  toolCalls?: ToolCallInfo[]
  codeExecutions?: CodeExecutionBlock[]
  createdAt: Date
}

export interface Conversation {
  id: string
  userId: string
  title: string
  systemPrompt?: string | null
  systemPromptId?: string | null
  defaultModel?: string | null
  createdAt: Date
  updatedAt: Date
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

export interface ChatStreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'usage' | 'done' | 'error' | 'tool_call' | 'tool_result' | 'code_execution_start' | 'code_execution_delta' | 'code_execution_result' | 'code_execution_files'
  text?: string
  thinking?: string
  inputTokens?: number
  outputTokens?: number
  error?: string
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> }
  toolResult?: { toolCallId: string; toolName: string; result: string }
  stopReason?: 'end' | 'tool_use'
  codeExecution?: { id: string; name: string }
  codeExecutionDelta?: { id: string; partialInput: string }
  codeExecutionResult?: { id: string; stdout?: string; stderr?: string; returnCode?: number; error?: string; files?: CodeExecutionFile[] }
  codeExecutionFiles?: { id: string; files: CodeExecutionFile[] }
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

export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high' | 'max'

export const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}
