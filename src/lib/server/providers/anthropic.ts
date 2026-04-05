import { formatModelRef } from '$lib/model-ref'
import type { ChatMessage, ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderCapability, ProviderFactory } from './types'
import Anthropic from '@anthropic-ai/sdk'

const mapCapabilities = (caps: Anthropic.ModelCapabilities | null): ProviderCapability[] => {
  const result: ProviderCapability[] = ['streaming', 'system_prompt']
  if (caps?.image_input?.supported) result.push('vision')
  if (caps?.code_execution?.supported) result.push('code_interpreter')
  return result
}

const buildAnthropicContent = (m: ChatMessage): string | Anthropic.ContentBlockParam[] => {
  if (!m.images?.length) return m.content
  const parts: Anthropic.ContentBlockParam[] = m.images.map(img => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: img.mimeType as Anthropic.Base64ImageSource['media_type'], data: img.data },
  }))
  if (m.content) {
    parts.push({ type: 'text' as const, text: m.content })
  }
  return parts
}

const createAnthropicAdapter = (apiKey: string): LLMProvider => ({
  id: 'anthropic',
  name: 'Anthropic',
  capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],

  listModels: async () => {
    const client = new Anthropic({ apiKey })
    const models: ModelInfo[] = []
    for await (const model of client.models.list({ limit: 100 })) {
      models.push({
        id: formatModelRef('anthropic', model.id),
        name: model.display_name,
        contextWindow: model.max_input_tokens ?? 200_000,
        maxOutputTokens: model.max_tokens ?? 4096,
        capabilities: mapCapabilities(model.capabilities),
      })
    }
    return models
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const client = new Anthropic({ apiKey })

    const useThinking = request.thinkingEffort && request.thinkingEffort !== 'none'
    const baseMaxTokens = request.maxTokens ?? 4096
    const maxTokens = useThinking ? Math.max(baseMaxTokens, 16000) : baseMaxTokens

    const params: Record<string, unknown> = {
      model: request.model,
      max_tokens: maxTokens,
      temperature: useThinking ? undefined : request.temperature,
      system: request.systemPrompt,
      messages: request.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: buildAnthropicContent(m),
      })),
    }

    if (useThinking) {
      params.thinking = { type: 'adaptive' }
      params.output_config = { effort: request.thinkingEffort }
    }

    const stream = client.messages.stream(
      params as Anthropic.MessageStreamParams,
      { signal: request.signal },
    )

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', thinking: (event.delta as { thinking: string }).thinking }
          } else if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text }
          }
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
