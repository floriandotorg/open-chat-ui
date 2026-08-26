import { formatModelRef } from '$lib/model-ref'
import type { ProviderModel } from '$lib/server/db/records'
import type { ModelInfo } from '$lib/server/providers/types'

export const fallbackModelInfo = (provider: string, modelId: string): ModelInfo => ({
  id: formatModelRef(provider, modelId),
  name: modelId,
  contextWindow: 0,
  maxOutputTokens: 0,
  capabilities: ['streaming', 'system_prompt'],
})

export const storedModelInfo = (s: ProviderModel): ModelInfo => s.metadata ?? fallbackModelInfo(s.provider, s.modelId)
