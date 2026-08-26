import { filterOpenRouterModels, mapOpenRouterModel, type OpenRouterRawModel } from './openrouter'
import { describe, expect, it } from 'vitest'

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
