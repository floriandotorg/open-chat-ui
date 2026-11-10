import type { ToolProgress } from '#lib/types.ts'

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string } & Record<string, unknown>>
    required?: string[]
  }
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string | ToolExecutionOutput>
}

export interface ToolExecutionOutput {
  result: string
  rawResult?: string
  cost?: number
}

export interface ToolAttachment {
  id: string
  name: string
  mimeType: string
}

export interface ToolContext {
  userId: string
  getApiKey: (provider: string) => Promise<string | null>
  getApiKeys: (provider: string) => Promise<string[]>
  conversationId?: string
  toolCallId?: string
  signal?: AbortSignal
  attachments?: ToolAttachment[]
  emitProgress?: (progress: ToolProgress) => void
}
