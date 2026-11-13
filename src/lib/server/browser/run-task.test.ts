import type { BrowserAgent } from '#lib/server/browser/agent.ts'
import { createFakeHost } from '#lib/server/browser/fake-host.ts'
import { BrowserHostError } from '#lib/server/browser/host-client.ts'
import { type BrowserTaskDeps, runBrowserTask } from '#lib/server/browser/run-task.ts'
import { getBrowserSession } from '#lib/server/browser/sessions.ts'
import { getPricing } from '#lib/server/pricing.ts'
import type { ToolContext } from '#lib/server/tools/types.ts'
import { resolveMessageCost } from '#lib/server/usage-cost.ts'
import type { ToolProgress } from '#lib/types.ts'
import { describe, expect, it, vi } from 'vitest'

const setup = (agent: BrowserAgent, overrides: Partial<BrowserTaskDeps> = {}) => {
  const fake = createFakeHost()
  const closed: string[] = []
  fake.host.closeSession = async sessionId => {
    closed.push(sessionId)
  }
  const staged: string[] = []
  const stageFile = fake.host.stageFile
  fake.host.stageFile = (sessionId, fileId, name, data) => {
    staged.push(`${fileId}:${name}`)
    return stageFile(sessionId, fileId, name, data)
  }
  const progress: ToolProgress[] = []
  const context: ToolContext = {
    userId: 'u1',
    conversationId: 'c1',
    getApiKey: async () => null,
    getApiKeys: async () => [],
    attachments: [
      { id: 'up1', name: 'front.jpg', mimeType: 'image/jpeg' },
      { id: 'missing', name: 'gone.jpg', mimeType: 'image/jpeg' },
    ],
    emitProgress: p => progress.push(p),
  }
  const deps: BrowserTaskDeps = {
    loadConfig: async () => ({ provider: 'anthropic', model: 'claude-sonnet-5-5', modelRef: 'anthropic/claude-sonnet-5-5', apiKey: 'k', host: fake.host }),
    agents: { anthropic: agent, openai: agent, chatgpt: agent },
    readAttachment: async attachment => (attachment.id === 'missing' ? null : new Uint8Array([1, 2, 3])),
    priceUsage: async (_modelRef, usage) => usage.inputTokens / 1000,
    sleep: async () => {},
    ...overrides,
  }
  return { ...fake, closed, staged, progress, context, deps }
}

describe('runBrowserTask', () => {
  it('runs the configured agent with staged files and closes the session', async () => {
    const agent: BrowserAgent = async ({ session, usage }) => {
      usage.inputTokens = 2000
      expect(getBrowserSession('s1', 'u1')).not.toBeNull()
      expect(session.files).toEqual([{ id: 'file_1', name: 'front.jpg', size: 3 }])
      return 'Listed the item.'
    }
    const { context, deps, closed, staged, calls } = setup(agent)
    const output = await runBrowserTask({ task: 'List it', startUrl: 'https://www.ebay.de/' }, context, deps)
    expect(output.result).toBe('Listed the item.\n\nFinal page: https://example.com/')
    expect(output.rawResult).toBe('1. Prepared 1 file for upload\n2. Opening ebay.de')
    expect(output.cost).toBe(2)
    expect(staged).toEqual(['file_1:front.jpg'])
    expect(calls[0].actions).toEqual([{ type: 'navigate', url: 'https://www.ebay.de/' }])
    expect(closed).toEqual(['s1'])
    expect(getBrowserSession('s1', 'u1')).toBeNull()
  })

  it('dispatches subscription tasks without API agents or model charges', async () => {
    const chatgpt: BrowserAgent = async ({ usage }) => {
      usage.inputTokens = 2000
      usage.outputTokens = 1000
      return 'Read your listings.'
    }
    const paidAgent = vi.fn(async () => 'unused')
    const { context, deps, host } = setup(chatgpt)
    deps.loadConfig = async () => ({ provider: 'chatgpt', model: 'gpt-5.4', modelRef: 'chatgpt/gpt-5.4', apiKey: 'plan-token', host })
    deps.agents = { anthropic: paidAgent, openai: paidAgent, chatgpt }
    deps.priceUsage = async (modelRef, usage) => resolveMessageCost(usage, await getPricing(modelRef)).cost
    const output = await runBrowserTask({ task: 'Read my listings' }, context, deps)
    expect(output.result).toContain('Read your listings.')
    expect(output.cost).toBe(0)
    expect(paidAgent).not.toHaveBeenCalled()
  })

  it('passes renewable credentials to the agent after startup and navigation', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('fresh-token')
    const agent: BrowserAgent = async run => {
      expect(run.getAccessToken).toBe(getAccessToken)
      expect(await run.getAccessToken?.()).toBe('fresh-token')
      return 'done'
    }
    const { context, deps, host } = setup(agent)
    deps.loadConfig = async () => ({ provider: 'chatgpt', model: 'gpt-5.4', modelRef: 'chatgpt/gpt-5.4', apiKey: 'old-token', getAccessToken, host })
    expect((await runBrowserTask({ task: 'x', startUrl: 'https://example.com' }, context, deps)).result).toMatch(/^done/)
    expect(getAccessToken).toHaveBeenCalledOnce()
  })

  it('reports configuration problems without touching the host', async () => {
    const { context, deps } = setup(async () => 'unused', { loadConfig: async () => ({ error: 'Choose a browser agent model in Settings > Tools.' }) })
    expect((await runBrowserTask({ task: 'x' }, context, deps)).result).toBe('Error: Choose a browser agent model in Settings > Tools.')
  })

  it('retries while the browser is busy', async () => {
    const { context, deps, host } = setup(async () => 'done')
    let attempts = 0
    const open = host.openSession
    host.openSession = async signal => {
      ++attempts
      if (attempts < 3) {
        throw new BrowserHostError('busy', 409)
      }
      return open(signal)
    }
    expect((await runBrowserTask({ task: 'x' }, context, deps)).result).toMatch(/^done/)
    expect(attempts).toBe(3)
  })

  it('keeps the step log and cost when the agent fails', async () => {
    const agent: BrowserAgent = async ({ session, usage }) => {
      usage.inputTokens = 1000
      await session.act([{ type: 'screenshot' }])
      throw new Error('model overloaded')
    }
    const { context, deps, closed } = setup(agent)
    const output = await runBrowserTask({ task: 'x' }, context, deps)
    expect(output.result).toBe('Error: the browser task failed: model overloaded')
    expect(output.rawResult).toBe('1. Prepared 1 file for upload\n2. Looking at the page')
    expect(output.cost).toBe(1)
    expect(closed).toEqual(['s1'])
  })

  it('reports a stop by the user', async () => {
    const controller = new AbortController()
    const agent: BrowserAgent = async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    }
    const { context, deps } = setup(agent)
    expect((await runBrowserTask({ task: 'x' }, { ...context, signal: controller.signal }, deps)).result).toBe('Stopped by the user.')
  })
})
