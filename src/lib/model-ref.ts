import type { ModelInfo } from '$lib/types'

export const formatModelRef = (provider: string, model: string): string => `${provider}/${model}`

export const parseModelRef = (modelRef: string): { provider: string; model: string } => {
  const idx = modelRef.indexOf('/')
  if (idx === -1) {
    throw new Error(`Invalid model reference: ${modelRef}. Expected format: provider/model`)
  }
  return { provider: modelRef.slice(0, idx), model: modelRef.slice(idx + 1) }
}

export const normalizeModelRef = (provider: string | null | undefined, model: string | null | undefined): string | null => {
  if (!model) return null
  if (model.includes('/')) return model
  if (provider) return formatModelRef(provider, model)
  return model
}

export const byProviderThenName = (a: ModelInfo, b: ModelInfo): number => {
  const providerA = parseModelRef(a.id).provider
  const providerB = parseModelRef(b.id).provider
  return providerA !== providerB ? providerA.localeCompare(providerB) : a.name.localeCompare(b.name)
}
