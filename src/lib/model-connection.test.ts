import { canonicalModelRef, connectionModelRef, modelsForConnection, providersForConnection } from './model-connection'
import type { ModelInfo, ProviderInfo } from './types'
import { describe, expect, it } from 'vitest'

const model = (id: string, name = 'GPT'): ModelInfo => ({ id, name, contextWindow: 100, maxOutputTokens: 10, capabilities: ['streaming'] })
const providers: ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', hasKey: true },
  { id: 'chatgpt', name: 'ChatGPT plan', hasKey: true },
  { id: 'anthropic', name: 'Anthropic', hasKey: true },
]

describe('model connections', () => {
  it('defaults to API and normalizes legacy subscription references', () => {
    expect(connectionModelRef('chatgpt/gpt-5', 'api')).toBe('openai/gpt-5')
    expect(canonicalModelRef('chatgpt/gpt-5')).toBe('openai/gpt-5')
    expect(connectionModelRef('anthropic/claude', 'subscription')).toBe('anthropic/claude')
  })

  it('routes the stable model reference through the selected subscription', () => {
    expect(connectionModelRef('openai/gpt-5', 'subscription')).toBe('chatgpt/gpt-5')
  })

  it('lists each model once using the active connection metadata', () => {
    const models = [model('openai/gpt-5', 'GPT 5'), model('chatgpt/gpt-5', 'GPT 5 (ChatGPT plan)'), model('chatgpt/plan-only', 'Plan only'), model('openai/api-only', 'API only'), model('anthropic/claude', 'Claude')]
    expect(modelsForConnection(models, new Set(['openai', 'chatgpt', 'anthropic']), 'api').map(m => m.id)).toEqual(['anthropic/claude', 'openai/api-only', 'openai/gpt-5'])
    expect(modelsForConnection(models, new Set(['openai', 'chatgpt', 'anthropic']), 'subscription').map(m => [m.id, m.name])).toEqual([
      ['anthropic/claude', 'Claude'],
      ['openai/gpt-5', 'GPT 5'],
      ['openai/plan-only', 'Plan only'],
    ])
  })

  it('never falls back to a paid API connection when the subscription is missing', () => {
    expect(modelsForConnection([model('openai/gpt-5')], new Set(['openai']), 'subscription')).toEqual([])
    expect(
      providersForConnection(
        providers.filter(p => p.id !== 'chatgpt'),
        'subscription',
      ).find(p => p.id === 'openai')?.hasKey,
    ).toBe(false)
  })

  it('shows a single OpenAI provider with the active connection status', () => {
    expect(providersForConnection(providers, 'subscription').map(p => [p.id, p.hasKey])).toEqual([
      ['openai', true],
      ['anthropic', true],
    ])
  })
})
