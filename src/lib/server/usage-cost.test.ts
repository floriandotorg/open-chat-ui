import { resolveMessageCost } from './usage-cost'
import { describe, expect, it } from 'vitest'

const pricing = {
  input: 1 / 1_000_000,
  output: 2 / 1_000_000,
  cacheRead: 0.1 / 1_000_000,
  cacheCreation: 1.5 / 1_000_000,
}

describe('resolveMessageCost', () => {
  it('prefers the provider-reported cost when present', () => {
    const r = resolveMessageCost({ inputTokens: 1000, outputTokens: 1000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cost: 0.42 }, pricing)
    expect(r.cost).toBe(0.42)
    expect(r.priced).toBe(true)
    expect(r.savings).toBe(0)
  })

  it('computes cost from static pricing when no reported cost', () => {
    const r = resolveMessageCost({ inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, pricing)
    expect(r.cost).toBeCloseTo(0.002)
    expect(r.priced).toBe(true)
  })

  it('computes cache savings from static pricing', () => {
    const r = resolveMessageCost({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1000, cacheCreationInputTokens: 0 }, pricing)
    expect(r.savings).toBeCloseTo(1000 * (pricing.input - pricing.cacheRead))
  })

  it('is unpriced without reported cost or pricing', () => {
    const r = resolveMessageCost({ inputTokens: 100, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, null)
    expect(r.cost).toBe(0)
    expect(r.priced).toBe(false)
  })
})
