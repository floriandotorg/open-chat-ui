import type { ModelPricing } from '$lib/server/pricing'

export interface MessageUsageRow {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  cost?: number | null
}

export interface ResolvedCost {
  cost: number
  savings: number
  priced: boolean
}

export const resolveMessageCost = (row: MessageUsageRow, pricing: ModelPricing | null): ResolvedCost => {
  if (typeof row.cost === 'number' && row.cost > 0) {
    return { cost: row.cost, savings: 0, priced: true }
  }
  if (!pricing) {
    return { cost: 0, savings: 0, priced: false }
  }
  const cost = row.inputTokens * pricing.input + row.outputTokens * pricing.output + row.cacheReadInputTokens * pricing.cacheRead + row.cacheCreationInputTokens * pricing.cacheCreation
  const savings = row.cacheReadInputTokens * (pricing.input - pricing.cacheRead)
  return { cost, savings, priced: true }
}
