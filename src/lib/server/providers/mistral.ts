import { formatModelRef } from '$lib/model-ref'
import type { ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderCapability, ProviderFactory } from './types'
import { Mistral } from '@mistralai/mistralai'

const mapCapabilities = (caps: { completionChat: boolean; vision: boolean; functionCalling: boolean }): ProviderCapability[] => {
  const result: ProviderCapability[] = ['streaming', 'system_prompt']
  if (caps.vision) result.push('vision')
  if (caps.functionCalling) result.push('tool_use')
  return result
}

const createMistralAdapter = (apiKey: string): LLMProvider => ({
  id: 'mistral',
  name: 'Mistral',
  capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],

  listModels: async () => {
    const client = new Mistral({ apiKey })
    const response = await client.models.list()
    const models: ModelInfo[] = []
    for (const model of response.data ?? []) {
      if (!('id' in model) || !('capabilities' in model)) continue
      if (!model.capabilities.completionChat) continue
      models.push({
        id: formatModelRef('mistral', model.id),
        name: ('name' in model ? model.name : null) ?? model.id,
        contextWindow: model.maxContextLength ?? 128_000,
        maxOutputTokens: 4096,
        capabilities: mapCapabilities(model.capabilities),
      })
    }
    return models
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const client = new Mistral({ apiKey })

    const messages = request.messages.map(m => {
      if (m.role === 'system') return { role: 'system' as const, content: m.content }
      if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content }
      return { role: 'user' as const, content: m.content }
    })

    if (request.systemPrompt) {
      messages.unshift({ role: 'system', content: request.systemPrompt })
    }

    try {
      const stream = await client.chat.stream({
        model: request.model,
        maxTokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? undefined,
        messages,
      })

      let usage = { promptTokens: 0, completionTokens: 0 }

      for await (const event of stream) {
        const delta = event.data.choices[0]?.delta
        if (typeof delta?.content === 'string' && delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }
        if (event.data.usage) {
          usage = {
            promptTokens: event.data.usage.promptTokens ?? 0,
            completionTokens: event.data.usage.completionTokens ?? 0,
          }
        }
      }

      yield { type: 'usage', inputTokens: usage.promptTokens, outputTokens: usage.completionTokens }
      yield { type: 'done' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      yield { type: 'error', error: message }
    }
  },
})

export const createMistralProvider: ProviderFactory = createMistralAdapter
