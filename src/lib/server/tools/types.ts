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
}

export interface ToolContext {
  userId: string
  getApiKey: (provider: string) => Promise<string | null>
  getApiKeys: (provider: string) => Promise<string[]>
}
