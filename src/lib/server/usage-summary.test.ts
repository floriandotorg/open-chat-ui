import type { ModelPricing } from './pricing'
import { summarizeUsage, type UsageRow } from './usage-summary'
import { describe, expect, it } from 'vitest'

const perMillion = (input: number, output: number, cacheRead = 0): ModelPricing => ({ input: input / 1_000_000, output: output / 1_000_000, cacheRead: cacheRead / 1_000_000, cacheCreation: 0 })

const PRICING: Record<string, ModelPricing> = {
  'anthropic/claude-x': perMillion(3, 15),
  'chatgpt/gpt-5.5': perMillion(2, 10, 0.2),
}

const pricingFor = (model: string) => PRICING[model] ?? null

const NOW = new Date(2026, 10, 10, 15, 0)

const row = (overrides: Partial<UsageRow>): UsageRow => ({
  model: 'anthropic/claude-x',
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  cost: 0,
  createdAt: new Date(2026, 10, 3, 12, 0).toISOString(),
  ...overrides,
})

describe('summarizeUsage', () => {
  it('keeps the same model split by its historical connection', () => {
    const summary = summarizeUsage([row({ model: 'openai/gpt-5.5', cost: 2 }), row({ model: 'chatgpt/gpt-5.5' })], pricingFor, NOW)
    expect(summary.api.cost).toBe(2)
    expect(summary.plan.cost).toBe(0)
    expect(summary.plan.apiEquivalentCost).toBeCloseTo(3)
    expect(summary.models.map(m => [m.model, m.billing])).toEqual([
      ['chatgpt/gpt-5.5', 'plan'],
      ['openai/gpt-5.5', 'api'],
    ])
  })

  it('bills API models at their price', () => {
    const summary = summarizeUsage([row({})], pricingFor, NOW)
    expect(summary.api).toMatchObject({ requests: 1, inputTokens: 1_000_000, outputTokens: 100_000 })
    expect(summary.api.cost).toBeCloseTo(4.5)
    expect(summary.api.apiEquivalentCost).toBeCloseTo(4.5)
    expect(summary.plan.requests).toBe(0)
  })

  it('keeps plan usage out of the API bill and prices it at API rates', () => {
    const summary = summarizeUsage([row({ model: 'chatgpt/gpt-5.5', cacheReadInputTokens: 500_000 })], pricingFor, NOW)
    expect(summary.api.requests).toBe(0)
    expect(summary.plan).toMatchObject({ requests: 1, inputTokens: 1_000_000, outputTokens: 100_000, cacheReadInputTokens: 500_000, cost: 0 })
    expect(summary.plan.apiEquivalentCost).toBeCloseTo(2 + 1 + 0.1)
  })

  it('counts paid tool calls on plan messages as cost without inflating the API equivalent', () => {
    const summary = summarizeUsage([row({ model: 'chatgpt/gpt-5.5', cost: 0.05 })], pricingFor, NOW)
    expect(summary.plan.cost).toBeCloseTo(0.05)
    expect(summary.plan.apiEquivalentCost).toBeCloseTo(3)
  })

  it('prefers a provider-reported cost for API models', () => {
    expect(summarizeUsage([row({ cost: 0.42 })], pricingFor, NOW).api.cost).toBeCloseTo(0.42)
  })

  it('marks models without pricing as unpriced', () => {
    const summary = summarizeUsage([row({ model: 'chatgpt/gpt-unknown' })], pricingFor, NOW)
    expect(summary.models).toEqual([expect.objectContaining({ model: 'chatgpt/gpt-unknown', billing: 'plan', priced: false, apiEquivalentCost: 0 })])
  })

  it('aggregates per model with its billing, most expensive first', () => {
    const summary = summarizeUsage([row({}), row({ model: 'chatgpt/gpt-5.5' }), row({ model: 'chatgpt/gpt-5.5' })], pricingFor, NOW)
    expect(summary.models.map(m => [m.model, m.billing, m.requests])).toEqual([
      ['chatgpt/gpt-5.5', 'plan', 2],
      ['anthropic/claude-x', 'api', 1],
    ])
  })

  it('buckets API cost and plan equivalent per day up to today', () => {
    const summary = summarizeUsage([row({}), row({ model: 'chatgpt/gpt-5.5', createdAt: new Date(2026, 10, 3, 18, 0).toISOString() })], pricingFor, NOW)
    expect(summary.month).toBe('2026-11')
    expect(summary.daily).toHaveLength(10)
    const day = summary.daily.find(d => d.date === '2026-11-03')
    expect(day?.requests).toBe(2)
    expect(day?.apiCost).toBeCloseTo(4.5)
    expect(day?.planApiEquivalentCost).toBeCloseTo(3)
  })
})
