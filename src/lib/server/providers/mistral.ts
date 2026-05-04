import { formatModelRef } from '$lib/model-ref'
import type { ChatMessage, ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderCapability, ProviderFactory, ToolCallInfo } from './types'
import { Mistral } from '@mistralai/mistralai'

const mapCapabilities = (caps: { completionChat: boolean; vision: boolean; functionCalling: boolean }): ProviderCapability[] => {
  const result: ProviderCapability[] = ['streaming', 'system_prompt']
  if (caps.vision) result.push('vision')
  if (caps.functionCalling) result.push('tool_use')
  return result
}

type MistralContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; imageUrl: { url: string } }>

const buildMistralContent = (m: ChatMessage): MistralContent => {
  if (!m.images?.length) return m.content
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; imageUrl: { url: string } }> = m.images.map(img => ({
    type: 'image_url' as const,
    imageUrl: { url: `data:${img.mimeType};base64,${img.data}` },
  }))
  if (m.content) {
    parts.push({ type: 'text' as const, text: m.content })
  }
  return parts
}

const buildMistralMessages = (messages: ChatMessage[], systemPrompt?: string) => {
  const result: Array<Record<string, unknown>> = []

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  for (const m of messages) {
    if (m.role === 'system') {
      result.push({ role: 'system', content: m.content })
    } else if (m.role === 'tool') {
      result.push({
        role: 'tool',
        content: m.content,
        toolCallId: m.toolCallId,
        name: m.toolCallId,
      })
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      result.push({
        role: 'assistant',
        content: m.content || '',
        toolCalls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      })
    } else if (m.role === 'user') {
      result.push({ role: 'user', content: buildMistralContent(m) })
    } else {
      result.push({ role: m.role, content: m.content })
    }
  }

  return result
}

const createMistralAdapter = (apiKey: string): LLMProvider => ({
  id: 'mistral',
  name: 'Mistral',
  capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],

  listModels: async () => {
    const client = new Mistral({ apiKey })
    const response = await client.models.list()
    const seen = new Map<string, ModelInfo>()
    for (const model of response.data ?? []) {
      if (!('id' in model) || !('capabilities' in model)) continue
      if (!model.capabilities.completionChat) continue
      const id = formatModelRef('mistral', model.id)
      if (seen.has(id)) continue
      seen.set(id, {
        id,
        name: ('name' in model ? model.name : null) ?? model.id,
        contextWindow: model.maxContextLength ?? 128_000,
        maxOutputTokens: 4096,
        capabilities: mapCapabilities(model.capabilities),
      })
    }
    return [...seen.values()]
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const client = new Mistral({ apiKey })

    const messages = buildMistralMessages(request.messages, request.systemPrompt)

    const streamParams: Record<string, unknown> = {
      model: request.model,
      maxTokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? undefined,
      messages,
    }

    if (request.tools?.length) {
      streamParams.tools = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }

    try {
      const stream = await client.chat.stream(streamParams as Parameters<typeof client.chat.stream>[0])

      let usage = { promptTokens: 0, completionTokens: 0 }
      const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>()
      let stopReason: 'end' | 'tool_use' = 'end'

      for await (const event of stream) {
        const choice = event.data.choices[0]
        const delta = choice?.delta
        if (typeof delta?.content === 'string' && delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }
        if (delta && 'toolCalls' in delta && Array.isArray(delta.toolCalls)) {
          for (const [idx, tc] of delta.toolCalls.entries()) {
            const tcObj = tc as { id?: string; function?: { name?: string; arguments?: string } }
            const key = idx
            if (!toolCallAccumulator.has(key)) {
              toolCallAccumulator.set(key, { id: '', name: '', args: '' })
            }
            const acc = toolCallAccumulator.get(key)
            if (!acc) continue
            if (tcObj.id) acc.id = tcObj.id
            if (tcObj.function?.name) acc.name = tcObj.function.name
            if (tcObj.function?.arguments) acc.args += tcObj.function.arguments
          }
        }
        if (choice?.finishReason === 'tool_calls') {
          stopReason = 'tool_use'
        }
        if (event.data.usage) {
          usage = {
            promptTokens: event.data.usage.promptTokens ?? 0,
            completionTokens: event.data.usage.completionTokens ?? 0,
          }
        }
      }

      for (const [_, tc] of toolCallAccumulator) {
        const toolCall: ToolCallInfo = {
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.args || '{}'),
        }
        yield { type: 'tool_call', toolCall }
      }

      yield { type: 'usage', inputTokens: usage.promptTokens, outputTokens: usage.completionTokens }
      yield { type: 'done', stopReason }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      yield { type: 'error', error: message }
    }
  },
})

export const createMistralProvider: ProviderFactory = createMistralAdapter
