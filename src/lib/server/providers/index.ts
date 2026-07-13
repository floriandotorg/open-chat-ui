import { createAnthropicProvider } from './anthropic'
import { createMistralProvider } from './mistral'
import { createOpenAIProvider } from './openai'
import type { ProviderFactory } from './types'

const registry = new Map<string, ProviderFactory>([
  ['anthropic', createAnthropicProvider],
  ['mistral', createMistralProvider],
  ['openai', createOpenAIProvider],
])

export const getProviderFactory = (providerId: string): ProviderFactory => {
  const factory = registry.get(providerId)
  if (!factory) {
    throw new Error(`Unknown provider: ${providerId}`)
  }
  return factory
}

export const listProviders = () =>
  [...registry.entries()].map(([id, factory]) => {
    const instance = factory('')
    return { id, name: instance.name, capabilities: instance.capabilities }
  })
