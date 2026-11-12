import { byProviderThenName, formatModelRef, parseModelRef } from './model-ref'
import type { ModelInfo, ProviderInfo } from './types'

export type OpenAIConnection = 'api' | 'subscription'

export const parseOpenAIConnection = (value: unknown): OpenAIConnection => (value === 'subscription' ? 'subscription' : 'api')

export const canonicalModelRef = (modelRef: string): string => (modelRef.startsWith('chatgpt/') ? formatModelRef('openai', modelRef.slice('chatgpt/'.length)) : modelRef)

export const connectionModelRef = (modelRef: string, connection: OpenAIConnection): string => {
  const canonical = canonicalModelRef(modelRef)
  return connection === 'subscription' && canonical.startsWith('openai/') ? formatModelRef('chatgpt', canonical.slice('openai/'.length)) : canonical
}

export const modelsForConnection = (models: ModelInfo[], configured: Set<string>, connection: OpenAIConnection): ModelInfo[] => {
  const source = connection === 'subscription' ? 'chatgpt' : 'openai'
  const visible = new Map<string, ModelInfo>()
  for (const model of models) {
    const { provider } = parseModelRef(model.id)
    if (!configured.has(provider) || ((provider === 'openai' || provider === 'chatgpt') && provider !== source)) {
      continue
    }
    const id = canonicalModelRef(model.id)
    visible.set(id, { ...model, id, name: model.name.replace(/ \(ChatGPT plan\)$/, '') })
  }
  return [...visible.values()].sort(byProviderThenName)
}

export const providersForConnection = (providers: ProviderInfo[], connection: OpenAIConnection): ProviderInfo[] =>
  providers.filter(provider => provider.id !== 'chatgpt').map(provider => (provider.id === 'openai' && connection === 'subscription' ? { ...provider, hasKey: providers.some(candidate => candidate.id === 'chatgpt' && candidate.hasKey) } : provider))
