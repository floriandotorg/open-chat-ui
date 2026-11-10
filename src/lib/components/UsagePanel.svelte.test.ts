import { mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import '../../routes/layout.css'
import type { ModelUsage, UsageResponse, UsageTotals } from '#lib/types.ts'
import UsagePanel from './UsagePanel.svelte'

let instance: Record<string, unknown> | undefined

const totals = (overrides: Partial<UsageTotals> = {}): UsageTotals => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cost: 0, apiEquivalentCost: 0, ...overrides })

const model = (overrides: Partial<ModelUsage> & Pick<ModelUsage, 'model' | 'billing'>): ModelUsage => ({ priced: true, ...totals({ requests: 1 }), ...overrides })

const render = async (usage: UsageResponse) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(usage)),
  )
  instance = mount(UsagePanel, { target: document.body }) as Record<string, unknown>
  await vi.waitFor(() => {
    if (document.body.textContent?.includes('Loading usage')) throw new Error('still loading')
  })
  return (document.body.textContent ?? '').replace(/\s+/g, ' ')
}

afterEach(async () => {
  if (instance) await unmount(instance)
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

test('separates paid API usage from the ChatGPT plan and shows the cost without the plan', async () => {
  const text = await render({
    month: '2026-11',
    api: totals({ requests: 4, cost: 1.5, apiEquivalentCost: 1.5 }),
    plan: totals({ requests: 10, cost: 0.25, apiEquivalentCost: 12.4 }),
    daily: [{ date: '2026-11-01', apiCost: 1.75, planApiEquivalentCost: 12.4, requests: 14 }],
    models: [model({ model: 'chatgpt/gpt-6.1-sol', billing: 'plan', requests: 10, cost: 0.25, apiEquivalentCost: 12.4 }), model({ model: 'anthropic/claude-x', billing: 'api', requests: 4, cost: 1.5, apiEquivalentCost: 1.5 })],
  })

  expect(text).toContain('Paid $1.75')
  expect(text).toContain('ChatGPT plan, API equivalent $12.40')
  expect(text).toContain('Includes $0.25 of paid tools')
  expect(text).toContain('Without your ChatGPT plan, this month would have cost $14.15')
  expect(text).toContain('ChatGPT plan, per model')
  expect(text).toContain('API, per model')
  expect(document.querySelector('a[href="https://chatgpt.com/settings/usage"]')).not.toBeNull()
})

test('hides the plan breakdown when the plan was not used', async () => {
  const text = await render({
    month: '2026-11',
    api: totals({ requests: 2, cost: 0.5, apiEquivalentCost: 0.5 }),
    plan: totals(),
    daily: [{ date: '2026-11-01', apiCost: 0.5, planApiEquivalentCost: 0, requests: 2 }],
    models: [model({ model: 'anthropic/claude-x', billing: 'api', requests: 2, cost: 0.5, apiEquivalentCost: 0.5 })],
  })

  expect(text).toContain('Paid $0.50')
  expect(text).not.toContain('ChatGPT plan')
  expect(text).not.toContain('Without your ChatGPT plan')
})
