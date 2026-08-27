import { formatModelRef } from '$lib/model-ref'
import type { ChatMessage, ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderFactory, ToolCallInfo } from './types'
import OpenAI from 'openai'

const BASE_URL = 'https://openrouter.ai/api/v1'
const MODELS_URL = `${BASE_URL}/models`
const MODELS_TTL_MS = 60 * 60 * 1000
const SEARCH_LIMIT = 25

export interface OpenRouterRawModel {
  id: string
  name?: string
  context_length?: number | null
  architecture?: { input_modalities?: string[] }
  top_provider?: { max_completion_tokens?: number | null }
  supported_parameters?: string[]
  pricing?: { prompt?: string; completion?: string }
}

const perMillionToken = (value?: string): number | undefined => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n * 1_000_000 : undefined
}

export const mapOpenRouterModel = (raw: OpenRouterRawModel): ModelInfo => {
  const capabilities: ModelInfo['capabilities'] = ['streaming', 'system_prompt']
  if (raw.architecture?.input_modalities?.includes('image')) {
    capabilities.push('vision')
  }
  if (raw.supported_parameters?.includes('tools')) {
    capabilities.push('tool_use')
  }
  return {
    id: formatModelRef('openrouter', raw.id),
    name: raw.name ?? raw.id,
    contextWindow: raw.context_length ?? 0,
    maxOutputTokens: raw.top_provider?.max_completion_tokens ?? 0,
    capabilities,
    inputPricePerMToken: perMillionToken(raw.pricing?.prompt),
    outputPricePerMToken: perMillionToken(raw.pricing?.completion),
  }
}

export const filterOpenRouterModels = (models: ModelInfo[], query: string, limit = SEARCH_LIMIT): ModelInfo[] => {
  const q = query.trim().toLowerCase()
  const matches = q ? models.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) : models
  return matches.slice(0, limit)
}

let modelsCache: { data: OpenRouterRawModel[]; at: number } | null = null
let modelsPending: Promise<OpenRouterRawModel[]> | null = null

const fetchRawModels = async (): Promise<OpenRouterRawModel[]> => {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.data
  if (modelsPending) return modelsPending
  modelsPending = fetch(MODELS_URL)
    .then(async r => {
      if (!r.ok) throw new Error(`openrouter models fetch failed: ${r.status}`)
      const body = (await r.json()) as { data: OpenRouterRawModel[] }
      modelsCache = { data: body.data, at: Date.now() }
      modelsPending = null
      return body.data
    })
    .catch(err => {
      modelsPending = null
      throw err
    })
  return modelsPending
}

type MessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

const buildContent = (m: ChatMessage): MessageContent => {
  if (!m.images?.length) return m.content
  const parts: Exclude<MessageContent, string> = m.images.map(img => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mimeType};base64,${img.data}` },
  }))
  if (m.content) {
    parts.push({ type: 'text', text: m.content })
  }
  return parts
}

const buildMessages = (messages: ChatMessage[], systemPrompt?: string): Array<Record<string, unknown>> => {
  const result: Array<Record<string, unknown>> = []
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }
  for (const m of messages) {
    if (m.role === 'system') {
      result.push({ role: 'system', content: m.content })
    } else if (m.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    } else if (m.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      })
    } else {
      result.push({ role: 'user', content: buildContent(m) })
    }
  }
  return result
}

const reasoningDelta = (delta: unknown): string => {
  if (!delta || typeof delta !== 'object') return ''
  const d = delta as Record<string, unknown>
  if (typeof d.reasoning === 'string') return d.reasoning
  if (Array.isArray(d.reasoning_details)) {
    return d.reasoning_details
      .map(entry => {
        if (!entry || typeof entry !== 'object') return ''
        const text = (entry as Record<string, unknown>).text
        return typeof text === 'string' ? text : ''
      })
      .join('')
  }
  return ''
}

const mapEffort = (effort: 'low' | 'medium' | 'high' | 'max'): 'low' | 'medium' | 'high' => (effort === 'max' ? 'high' : effort)

type OpenRouterUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  cost?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

const createOpenRouterAdapter = (apiKey: string): LLMProvider => ({
  id: 'openrouter',
  name: 'OpenRouter',
  capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],
  supportsCustomModels: true,

  listModels: async () => [],

  searchModels: async (query: string) => filterOpenRouterModels((await fetchRawModels()).map(mapOpenRouterModel), query),

  getModelInfo: async (modelId: string) => {
    const ref = formatModelRef('openrouter', modelId)
    return (await fetchRawModels()).map(mapOpenRouterModel).find(m => m.id === ref) ?? null
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const client = new OpenAI({ apiKey, baseURL: BASE_URL })

    const params: Record<string, unknown> = {
      model: request.model,
      messages: buildMessages(request.messages, request.systemPrompt),
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? undefined,
      stream: true,
      stream_options: { include_usage: true },
      usage: { include: true },
    }

    if (request.thinkingEffort && request.thinkingEffort !== 'none') {
      params.reasoning = { effort: mapEffort(request.thinkingEffort) }
    }

    if (request.tools?.length) {
      params.tools = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }

    try {
      const stream = await client.chat.completions.create(params as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming, { signal: request.signal })

      let usage: OpenRouterUsage | undefined
      let stopReason: 'end' | 'tool_use' = 'end'
      const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>()

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        const delta = choice?.delta

        if (typeof delta?.content === 'string' && delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }

        const thinking = reasoningDelta(delta)
        if (thinking) {
          yield { type: 'thinking_delta', thinking }
        }

        if (delta?.tool_calls) {
          for (const [position, tc] of delta.tool_calls.entries()) {
            const key = tc.index ?? position
            let acc = toolCallAccumulator.get(key)
            if (!acc) {
              acc = { id: '', name: '', args: '' }
              toolCallAccumulator.set(key, acc)
            }
            if (tc.id) acc.id = tc.id
            if (tc.function?.name) acc.name = tc.function.name
            if (tc.function?.arguments) acc.args += tc.function.arguments
          }
        }

        if (choice?.finish_reason === 'tool_calls') {
          stopReason = 'tool_use'
        }

        if (chunk.usage) {
          usage = chunk.usage as OpenRouterUsage
        }
      }

      const toolCalls: ToolCallInfo[] = [...toolCallAccumulator.values()].map(tc => {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.args || '{}')
        } catch {}
        return { id: tc.id, name: tc.name, arguments: args }
      })

      for (const tc of toolCalls) {
        yield { type: 'tool_call', toolCall: tc }
      }

      const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0
      yield {
        type: 'usage',
        inputTokens: (usage?.prompt_tokens ?? 0) - cachedTokens,
        outputTokens: usage?.completion_tokens ?? 0,
        cacheReadInputTokens: cachedTokens,
        cost: usage?.cost,
      }
      yield { type: 'done', stopReason: toolCalls.length > 0 ? 'tool_use' : stopReason }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      yield { type: 'error', error: message }
    }
  },
})

export const createOpenRouterProvider: ProviderFactory = createOpenRouterAdapter
