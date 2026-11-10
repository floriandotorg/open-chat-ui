import type { DailyUsage, ModelUsage, UsageBilling, UsageResponse, UsageTotals } from '#lib/types.ts'
import { isPlanBilledModel, type ModelPricing } from './pricing'
import { type MessageUsageRow, resolveMessageCost } from './usage-cost'

export interface UsageRow extends MessageUsageRow {
  model: string | null
  createdAt: string
}

const positive = (value: unknown): number => (typeof value === 'number' && value > 0 ? value : 0)

const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

const dayKey = (d: Date): string => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`

const emptyTotals = (): UsageTotals => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cost: 0, apiEquivalentCost: 0 })

const addTo = (totals: UsageTotals, usage: UsageTotals) => {
  totals.requests += usage.requests
  totals.inputTokens += usage.inputTokens
  totals.outputTokens += usage.outputTokens
  totals.cacheReadInputTokens += usage.cacheReadInputTokens
  totals.cacheCreationInputTokens += usage.cacheCreationInputTokens
  totals.cost += usage.cost
  totals.apiEquivalentCost += usage.apiEquivalentCost
}

const rowUsage = (row: UsageRow, billing: UsageBilling, pricing: ModelPricing | null) => {
  const tokens = {
    requests: 1,
    inputTokens: positive(row.inputTokens),
    outputTokens: positive(row.outputTokens),
    cacheReadInputTokens: positive(row.cacheReadInputTokens),
    cacheCreationInputTokens: positive(row.cacheCreationInputTokens),
  }
  if (billing === 'plan') {
    const tokenCost = resolveMessageCost({ ...tokens, cost: 0 }, pricing)
    return { usage: { ...tokens, cost: positive(row.cost), apiEquivalentCost: tokenCost.cost }, priced: tokenCost.priced }
  }
  const { cost, priced } = resolveMessageCost(row, pricing)
  return { usage: { ...tokens, cost, apiEquivalentCost: cost }, priced }
}

export const summarizeUsage = (rows: UsageRow[], pricingFor: (model: string) => ModelPricing | null, now: Date): UsageResponse => {
  const daily = new Map<string, DailyUsage>()
  for (let day = 1; day <= now.getDate(); ++day) {
    const date = dayKey(new Date(now.getFullYear(), now.getMonth(), day))
    daily.set(date, { date, apiCost: 0, planApiEquivalentCost: 0, requests: 0 })
  }

  const totals: Record<UsageBilling, UsageTotals> = { api: emptyTotals(), plan: emptyTotals() }
  const models = new Map<string, ModelUsage>()

  for (const row of rows) {
    const model = row.model ?? ''
    const billing: UsageBilling = isPlanBilledModel(model) ? 'plan' : 'api'
    const { usage, priced } = rowUsage(row, billing, pricingFor(model))

    addTo(totals[billing], usage)

    const day = daily.get(dayKey(new Date(row.createdAt)))
    if (day) {
      day.requests += 1
      day.apiCost += usage.cost
      if (billing === 'plan') {
        day.planApiEquivalentCost += usage.apiEquivalentCost
      }
    }

    let modelUsage = models.get(model)
    if (!modelUsage) {
      modelUsage = { model, billing, priced, ...emptyTotals() }
      models.set(model, modelUsage)
    }
    modelUsage.priced ||= priced
    addTo(modelUsage, usage)
  }

  return {
    month: monthKey(now),
    api: totals.api,
    plan: totals.plan,
    daily: [...daily.values()],
    models: [...models.values()].sort((a, b) => b.apiEquivalentCost - a.apiEquivalentCost),
  }
}
