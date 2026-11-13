import { formatModelRef } from '#lib/model-ref.ts'
import type { ChatMessage, ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderFactory, ToolCallInfo } from './types'
import OpenAI from 'openai'

const REASONING_MODEL = /^(o[0-9]|gpt-[5-9])/

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

export const metaFor = (id: string) => MODEL_META[id] ?? { contextWindow: 128_000, maxOutputTokens: 16_384 }

const isReasoningModel = (id: string) => REASONING_MODEL.test(id)

export const formatModelName = (id: string) =>
  id
    .replace(/-/g, ' ')
    .replace(/\b(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bO\d+\b/g, (m: string) => m.toUpperCase())
    .replace(/\bOmni\b/g, 'Omni')
const mapEffort = (effort: 'low' | 'medium' | 'high' | 'max'): 'low' | 'medium' | 'high' => (effort === 'max' ? 'high' : effort)

const minimalEffort = (model: string): 'none' | 'minimal' | 'low' => (/^gpt-(5\.[1-9]|[6-9])/.test(model) ? 'none' : /^gpt-5/.test(model) ? 'minimal' : 'low')

type InputContent = string | Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'auto' }>

const buildInputContent = (m: ChatMessage): InputContent => {
  if (!m.images?.length) return m.content
  const parts: Exclude<InputContent, string> = m.images.map(img => ({
    type: 'input_image' as const,
    image_url: `data:${img.mimeType};base64,${img.data}`,
    detail: 'auto' as const,
  }))
  if (m.content) {
    parts.push({ type: 'input_text', text: m.content })
  }
  return parts
}

const buildResponsesInput = (messages: ChatMessage[], toolNamespace?: string): OpenAI.Responses.ResponseInput => {
  const input: OpenAI.Responses.ResponseInput = []

  for (const m of messages) {
    if (m.role === 'user') {
      input.push({ role: 'user', content: buildInputContent(m) })
    } else if (m.role === 'assistant') {
      if (m.content) {
        input.push({ role: 'assistant', content: m.content })
      }
      for (const tc of m.toolCalls ?? []) {
        input.push({ type: 'function_call', call_id: tc.id, name: tc.name, ...(toolNamespace ? { namespace: toolNamespace } : {}), arguments: JSON.stringify(tc.arguments) })
      }
    } else if (m.role === 'tool' && m.toolCallId) {
      input.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content })
    } else if (m.role === 'system') {
      input.push({ role: 'developer', content: m.content })
    }
  }

  return input
}

export type ResponsesBilling = 'api' | 'plan'

const PLAN_TOOL_NAMESPACE = 'app'

const buildFunctionTools = (request: ChatRequest) =>
  (request.tools ?? []).map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: false,
  }))

export const buildResponsesParams = (request: ChatRequest, billing: ResponsesBilling): Record<string, unknown> => {
  const reasoning = isReasoningModel(request.model)
  const useThinking = reasoning && request.thinkingEffort && request.thinkingEffort !== 'none'
  const planBilled = billing === 'plan'

  const params: Record<string, unknown> = {
    model: request.model,
    instructions: request.systemPrompt,
    input: buildResponsesInput(request.messages, planBilled ? PLAN_TOOL_NAMESPACE : undefined),
    stream: true,
  }

  if (planBilled) {
    params.store = false
  } else {
    params.max_output_tokens = request.maxTokens ?? 4096
  }

  if (request.outputSchema) {
    params.text = { format: { type: 'json_schema', ...request.outputSchema, strict: true } }
  }

  if (!reasoning && !planBilled) {
    params.temperature = request.temperature ?? undefined
  }

  if (reasoning) {
    params.reasoning = {
      effort: useThinking ? mapEffort(request.thinkingEffort as 'low' | 'medium' | 'high' | 'max') : minimalEffort(request.model),
      ...(useThinking ? { summary: 'auto' } : {}),
    }
  }

  if (request.tools?.length) {
    params.tools = planBilled ? [{ type: 'namespace', name: PLAN_TOOL_NAMESPACE, description: 'Tools provided by Open Chat UI', tools: buildFunctionTools(request) }] : buildFunctionTools(request)
  }

  return params
}

export type ResponsesErrorFormatter = (error: { code?: string; status?: number; message: string }) => string

export async function* streamResponses(client: OpenAI, request: ChatRequest, billing: ResponsesBilling, formatError: ResponsesErrorFormatter = ({ message }) => message): AsyncGenerator<ChatStreamEvent> {
  const params = buildResponsesParams(request, billing)

  try {
    const stream = await client.responses.create(params as unknown as OpenAI.Responses.ResponseCreateParamsStreaming, { signal: request.signal })

    let usage: OpenAI.Responses.ResponseUsage | undefined
    let completed = false
    let failed: string | undefined
    const toolCalls = new Map<string, ToolCallInfo>()

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'text_delta', text: event.delta }
      } else if (event.type === 'response.reasoning_summary_text.delta') {
        yield { type: 'thinking_delta', thinking: event.delta }
      } else if (event.type === 'response.output_item.added' && event.item.type === 'function_call') {
        toolCalls.set(event.item.id ?? event.item.call_id, { id: event.item.call_id, name: event.item.name, arguments: {} })
      } else if (event.type === 'response.function_call_arguments.done') {
        const tc = toolCalls.get(event.item_id)
        if (tc) {
          try {
            tc.arguments = JSON.parse(event.arguments || '{}')
          } catch {
            tc.arguments = {}
          }
        }
      } else if (event.type === 'response.completed') {
        usage = event.response.usage
        completed = true
      } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
        failed = event.response.error ? formatError({ code: event.response.error.code ?? undefined, message: event.response.error.message }) : (event.response.incomplete_details?.reason ?? `Response ${event.response.status}`)
      } else if (event.type === 'error') {
        failed = formatError({ code: event.code ?? undefined, message: event.message })
      }
    }

    if (!failed && !completed) {
      failed = 'The response ended before it completed'
    }

    if (failed && (billing === 'plan' || toolCalls.size === 0)) {
      yield { type: 'error', error: failed }
      return
    }

    for (const tc of toolCalls.values()) {
      yield { type: 'tool_call', toolCall: tc }
    }

    const cachedTokens = usage?.input_tokens_details.cached_tokens ?? 0
    yield {
      type: 'usage',
      inputTokens: (usage?.input_tokens ?? 0) - cachedTokens,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadInputTokens: cachedTokens,
    }
    yield { type: 'done', stopReason: toolCalls.size > 0 ? 'tool_use' : 'end' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const code = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : undefined
    const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' ? err.status : undefined
    yield { type: 'error', error: formatError({ code, status, message }) }
  }
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

  chat: (request: ChatRequest) => streamResponses(new OpenAI({ apiKey }), request, 'api'),
})

export const createOpenAIProvider: ProviderFactory = createOpenAIAdapter
