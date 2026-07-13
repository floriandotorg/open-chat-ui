import { formatModelRef } from '$lib/model-ref'
import type { ChatMessage, ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderFactory, ToolCallInfo } from './types'
import OpenAI from 'openai'

type OpenAIContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

const REASONING_MODEL = /^(o[0-9]|gpt-5)/

const MODEL_META: Record<string, { contextWindow: number; maxOutputTokens: number }> = {
  'gpt-4o': { contextWindow: 128_000, maxOutputTokens: 16_384 },
  'gpt-4o-mini': { contextWindow: 128_000, maxOutputTokens: 16_384 },
  'gpt-4.1': { contextWindow: 1_047_576, maxOutputTokens: 33_000 },
  'gpt-4.1-mini': { contextWindow: 1_047_576, maxOutputTokens: 33_000 },
  'gpt-4.1-nano': { contextWindow: 1_047_576, maxOutputTokens: 33_000 },
  o1: { contextWindow: 200_000, maxOutputTokens: 100_000 },
  'o1-mini': { contextWindow: 128_000, maxOutputTokens: 65_536 },
  'o1-pro': { contextWindow: 200_000, maxOutputTokens: 100_000 },
  o3: { contextWindow: 200_000, maxOutputTokens: 100_000 },
  'o3-mini': { contextWindow: 200_000, maxOutputTokens: 100_000 },
  'o4-mini': { contextWindow: 200_000, maxOutputTokens: 100_000 },
  'gpt-5': { contextWindow: 400_000, maxOutputTokens: 128_000 },
  'gpt-5-mini': { contextWindow: 400_000, maxOutputTokens: 128_000 },
  'gpt-5-nano': { contextWindow: 400_000, maxOutputTokens: 128_000 },
}

const CHAT_MODEL = /^(gpt-|o[0-9])/i

const metaFor = (id: string) => MODEL_META[id] ?? { contextWindow: 128_000, maxOutputTokens: 16_384 }

const isReasoningModel = (id: string) => REASONING_MODEL.test(id)

const formatModelName = (id: string) =>
  id
    .replace(/-/g, ' ')
    .replace(/\b(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bO\d+\b/g, (m: string) => m.toUpperCase())
    .replace(/\bOmni\b/g, 'Omni')
const mapEffort = (effort: 'low' | 'medium' | 'high' | 'max'): 'low' | 'medium' | 'high' => (effort === 'max' ? 'high' : effort)

const buildOpenAIContent = (m: ChatMessage): OpenAIContent => {
  if (!m.images?.length) return m.content
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = m.images.map(img => ({
    type: 'image_url',
    image_url: { url: `data:${img.mimeType};base64,${img.data}` },
  }))
  if (m.content) {
    parts.push({ type: 'text', text: m.content })
  }
  return parts
}

const buildOpenAIMessages = (messages: ChatMessage[], systemPrompt?: string) => {
  const result: Array<Record<string, unknown>> = []

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  for (const m of messages) {
    if (m.role === 'system') {
      result.push({ role: 'system', content: m.content })
    } else if (m.role === 'tool') {
      result.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId })
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      result.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      })
    } else if (m.role === 'user') {
      result.push({ role: 'user', content: buildOpenAIContent(m) })
    } else {
      result.push({ role: m.role, content: m.content })
    }
  }

  return result
}

const createOpenAIAdapter = (apiKey: string): LLMProvider => ({
  id: 'openai',
  name: 'OpenAI',
  capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],

  listModels: async () => {
    const client = new OpenAI({ apiKey })
    const seen = new Map<string, ModelInfo>()
    for await (const model of client.models.list()) {
      if (!CHAT_MODEL.test(model.id)) continue
      const id = formatModelRef('openai', model.id)
      if (seen.has(id)) continue
      const meta = metaFor(model.id)
      const caps: ModelInfo['capabilities'] = ['streaming', 'system_prompt', 'tool_use', 'vision']
      seen.set(id, {
        id,
        name: formatModelName(model.id),
        contextWindow: meta.contextWindow,
        maxOutputTokens: meta.maxOutputTokens,
        capabilities: caps,
      })
    }
    return [...seen.values()]
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const client = new OpenAI({ apiKey })

    const reasoning = isReasoningModel(request.model)
    const useThinking = reasoning && request.thinkingEffort && request.thinkingEffort !== 'none'

    const params: Record<string, unknown> = {
      model: request.model,
      max_completion_tokens: reasoning ? (request.maxTokens ?? 4096) : undefined,
      max_tokens: reasoning ? undefined : (request.maxTokens ?? 4096),
      messages: buildOpenAIMessages(request.messages, request.systemPrompt),
      stream: true,
      stream_options: { include_usage: true },
    }

    if (!reasoning) {
      params.temperature = request.temperature ?? undefined
    }

    if (reasoning) {
      params.reasoning_effort = request.tools?.length ? 'none' : useThinking ? mapEffort(request.thinkingEffort as 'low' | 'medium' | 'high' | 'max') : 'none'
    }

    if (request.tools?.length) {
      params.tools = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }

    try {
      const stream = await client.chat.completions.create(params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, { signal: request.signal })

      let usage = { promptTokens: 0, completionTokens: 0 }
      let stopReason: 'end' | 'tool_use' = 'end'
      const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>()

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        const delta = choice?.delta as Record<string, unknown> | undefined

        if (typeof delta?.content === 'string' && delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }

        const reasoningText = (delta?.reasoning ?? delta?.reasoning_content) as string | undefined
        if (typeof reasoningText === 'string' && reasoningText) {
          yield { type: 'thinking_delta', thinking: reasoningText }
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
            const idx = (tc.index as number) ?? 0
            if (!toolCallAccumulator.has(idx)) {
              toolCallAccumulator.set(idx, { id: '', name: '', args: '' })
            }
            const acc = toolCallAccumulator.get(idx)
            if (!acc) continue
            const fn = tc.function as Record<string, unknown> | undefined
            if (typeof tc.id === 'string') acc.id = tc.id
            if (typeof fn?.name === 'string') acc.name = fn.name
            if (typeof fn?.arguments === 'string') acc.args += fn.arguments
          }
        }

        if (choice?.finish_reason === 'tool_calls') {
          stopReason = 'tool_use'
        }

        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
          }
        }
      }

      for (const [, tc] of toolCallAccumulator) {
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

export const createOpenAIProvider: ProviderFactory = createOpenAIAdapter
