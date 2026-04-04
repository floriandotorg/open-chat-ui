export const formatModelRef = (provider: string, model: string): string =>
  `${provider}/${model}`

export const parseModelRef = (modelRef: string): { provider: string; model: string } => {
  const idx = modelRef.indexOf('/')
  if (idx === -1) {
    throw new Error(`Invalid model reference: ${modelRef}. Expected format: provider/model`)
  }
  return { provider: modelRef.slice(0, idx), model: modelRef.slice(idx + 1) }
}

export const normalizeModelRef = (
  provider: string | null | undefined,
  model: string | null | undefined,
): string | null => {
  if (!model) return null
  if (model.includes('/')) return model
  if (provider) return formatModelRef(provider, model)
  return model
}
