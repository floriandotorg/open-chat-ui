import { createOpenRouterProvider, filterOpenRouterModels, mapOpenRouterModel, type OpenRouterRawModel } from './openrouter'
import type { ChatStreamEvent } from './types'
import { describe, expect, it, vi } from 'vitest'

const streamChunks = vi.hoisted(() => ({ value: [] as unknown[] }))
const chatCreateArgs = vi.hoisted(() => ({ value: [] as unknown[] }))

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: async (args: unknown) => {
          chatCreateArgs.value.push(args)
          return {
            async *[Symbol.asyncIterator]() {
              for (const chunk of streamChunks.value) yield chunk
            },
          }
        },
      },
    }
  },
}))

const raw = (overrides: Partial<OpenRouterRawModel> = {}): OpenRouterRawModel => ({
  id: 'moonshotai/kimi-k3',
  name: 'MoonshotAI: Kimi K3',
  context_length: 262144,
  architecture: { input_modalities: ['text', 'image'] },
  top_provider: { max_completion_tokens: 65536 },
  supported_parameters: ['tools', 'temperature'],
  pricing: { prompt: '0.000003', completion: '0.000015' },
  ...overrides,
})

describe('mapOpenRouterModel', () => {
  it('converts per-token string pricing to per-million-token numbers', () => {
    const m = mapOpenRouterModel(raw())
    expect(m.inputPricePerMToken).toBe(3)
    expect(m.outputPricePerMToken).toBe(15)
  })

  it('prefixes the id with the provider', () => {
    expect(mapOpenRouterModel(raw()).id).toBe('openrouter/moonshotai/kimi-k3')
  })

  it('maps context length and max completion tokens', () => {
    const m = mapOpenRouterModel(raw())
    expect(m.contextWindow).toBe(262144)
    expect(m.maxOutputTokens).toBe(65536)
  })

  it('adds vision capability when image input is supported', () => {
    expect(mapOpenRouterModel(raw()).capabilities).toContain('vision')
    expect(mapOpenRouterModel(raw({ architecture: { input_modalities: ['text'] } })).capabilities).not.toContain('vision')
  })

  it('adds tool_use capability when tools parameter is supported', () => {
    expect(mapOpenRouterModel(raw()).capabilities).toContain('tool_use')
    expect(mapOpenRouterModel(raw({ supported_parameters: [] })).capabilities).not.toContain('tool_use')
  })

  it('omits pricing when absent or zero', () => {
    const m = mapOpenRouterModel(raw({ pricing: { prompt: '0', completion: undefined } }))
    expect(m.inputPricePerMToken).toBeUndefined()
    expect(m.outputPricePerMToken).toBeUndefined()
  })

  it('falls back to the id as name and zero windows when metadata is missing', () => {
    const m = mapOpenRouterModel({ id: 'a/b' })
    expect(m.name).toBe('a/b')
    expect(m.contextWindow).toBe(0)
    expect(m.maxOutputTokens).toBe(0)
  })
})

describe('filterOpenRouterModels', () => {
  const models = [mapOpenRouterModel(raw()), mapOpenRouterModel(raw({ id: 'openai/gpt-5', name: 'OpenAI: GPT-5' })), mapOpenRouterModel(raw({ id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5' }))]

  it('matches case-insensitively against id and name', () => {
    expect(filterOpenRouterModels(models, 'KIMI').map(m => m.id)).toEqual(['openrouter/moonshotai/kimi-k3'])
    expect(filterOpenRouterModels(models, 'gpt').map(m => m.id)).toEqual(['openrouter/openai/gpt-5'])
    expect(filterOpenRouterModels(models, 'claude').map(m => m.id)).toEqual(['openrouter/anthropic/claude-sonnet-4.5'])
  })

  it('returns everything up to the limit for an empty query', () => {
    expect(filterOpenRouterModels(models, '')).toHaveLength(3)
    expect(filterOpenRouterModels(models, '   ')).toHaveLength(3)
  })

  it('respects the limit', () => {
    expect(filterOpenRouterModels(models, '', 2)).toHaveLength(2)
  })
})

describe('chat provider routing', () => {
  const runChat = async (model: string) => {
    streamChunks.value = [{ choices: [{ delta: {}, finish_reason: 'stop' }] }]
    chatCreateArgs.value = []
    const provider = createOpenRouterProvider('key')
    for await (const _event of provider.chat({ model, messages: [] })) {
    }
    return chatCreateArgs.value.at(-1)
  }

  it('enforces zero data retention, denies data collection, and ignores untrusted providers by default', async () => {
    const args = await runChat('test-model')

    expect(args).toMatchObject({
      provider: {
        zdr: true,
        data_collection: 'deny',
        ignore: ['novita', 'siliconflow', 'alibaba', 'gmicloud', 'atlas-cloud', 'chutes', 'deepseek', 'moonshotai', 'z-ai', 'minimax', 'baidu', 'tencent', 'stepfun', 'xiaomi', 'phala', 'open-inference', 'sail-research', 'inceptron', 'nextbit', 'mancer', 'morph'],
      },
    })
  })

  it('pins overridden models to trusted providers without fallbacks', async () => {
    const args = await runChat('deepseek/deepseek-v4-flash-0731')

    expect(args).toMatchObject({
      provider: {
        zdr: true,
        data_collection: 'deny',
        only: ['baseten', 'fireworks', 'together', 'coreweave', 'makora', 'wafer', 'parasail', 'relace', 'venice'],
        allow_fallbacks: false,
      },
    })
    expect((args as { provider: Record<string, unknown> }).provider.ignore).toBeUndefined()
  })

  it('applies quantization and price caps for glm-5.3', async () => {
    const args = await runChat('z-ai/glm-5.3')

    expect(args).toMatchObject({
      provider: {
        quantizations: ['fp8'],
        only: ['fireworks', 'baseten', 'together', 'wafer', 'makora', 'coreweave', 'crusoe', 'digitalocean', 'parasail'],
        allow_fallbacks: false,
        max_price: { prompt: 1.4, completion: 4.4 },
      },
    })
  })

  it('applies price caps for kimi-k3', async () => {
    const args = await runChat('moonshotai/kimi-k3')

    expect(args).toMatchObject({
      provider: {
        only: ['fireworks', 'baseten', 'together', 'modal', 'wafer', 'makora', 'coreweave', 'crusoe', 'digitalocean'],
        allow_fallbacks: false,
        max_price: { prompt: 3, completion: 15 },
      },
    })
  })
})

describe('chat tool call streaming', () => {
  it('accumulates interleaved tool calls by their index, not array position', async () => {
    streamChunks.value = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'brave_search', arguments: '{"que' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_2', function: { name: 'brave_search', arguments: '{"que' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"cats"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'ry":"dogs"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]

    const provider = createOpenRouterProvider('key')
    const events: ChatStreamEvent[] = []
    for await (const event of provider.chat({ model: 'test-model', messages: [] })) {
      events.push(event)
    }

    const toolCalls = events.filter(e => e.type === 'tool_call').map(e => e.toolCall)
    expect(toolCalls).toEqual([
      { id: 'call_1', name: 'brave_search', arguments: { query: 'cats' } },
      { id: 'call_2', name: 'brave_search', arguments: { query: 'dogs' } },
    ])
  })
})
