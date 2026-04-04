import type { ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderFactory } from './types'
import Anthropic from '@anthropic-ai/sdk'

const MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 4,
  },
]

const createAnthropicAdapter = (apiKey: string): LLMProvider => ({
  id: 'anthropic',
  name: 'Anthropic',
  capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],

  listModels: async () => MODELS,

  async *chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const client = new Anthropic({ apiKey })

    const stream = client.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: request.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      },
      { signal: request.signal },
    )

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text }
        }
      }

      const finalMessage = await stream.finalMessage()
      yield {
        type: 'usage',
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      }
      yield { type: 'done' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      yield { type: 'error', error: message }
    }
  },
})

export const createAnthropicProvider: ProviderFactory = createAnthropicAdapter
