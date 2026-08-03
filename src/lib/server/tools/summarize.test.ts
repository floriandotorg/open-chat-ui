process.env.POCKETBASE_URL = 'http://127.0.0.1:1'

import type { ToolContext, ToolDefinition } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ctx: ToolContext = { userId: 'u1', getApiKey: async () => null, getApiKeys: async () => [] }

const makeTool = (result: string): ToolDefinition => ({
  name: 'test_search',
  description: 'Searches things.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The query' } },
    required: ['query'],
  },
  execute: async () => result,
})

describe('withSearchSummarization', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('adds research_question as a mandatory parameter', async () => {
    const { withSearchSummarization } = await import('./summarize')
    const wrapped = withSearchSummarization(makeTool('x'))
    expect(wrapped.parameters.required).toEqual(['query', 'research_question'])
    expect(wrapped.parameters.properties.research_question.type).toBe('string')
    expect(wrapped.parameters.properties.query).toBeDefined()
  })

  it('passes short results through unchanged', async () => {
    const { withSearchSummarization } = await import('./summarize')
    const raw = '1. [A](https://a.test) short result'
    const wrapped = withSearchSummarization(makeTool(raw))
    expect(await wrapped.execute({ query: 'q', research_question: 'What is A?' }, ctx)).toBe(raw)
  })

  it('passes through without a research question', async () => {
    const { withSearchSummarization } = await import('./summarize')
    const raw = `long ${'x'.repeat(5000)}`
    const wrapped = withSearchSummarization(makeTool(raw))
    expect(await wrapped.execute({ query: 'q' }, ctx)).toBe(raw)
  })

  it('passes error results through unchanged', async () => {
    const { withSearchSummarization } = await import('./summarize')
    const raw = `Error: ${'upstream failed '.repeat(500)}`
    const wrapped = withSearchSummarization(makeTool(raw))
    expect(await wrapped.execute({ query: 'q', research_question: 'q' }, ctx)).toBe(raw)
  })

  it('fails open to raw results when the summarizer is unavailable', async () => {
    const { withSearchSummarization } = await import('./summarize')
    const raw = `long ${'y'.repeat(5000)}`
    const wrapped = withSearchSummarization(makeTool(raw))
    expect(await wrapped.execute({ query: 'q', research_question: 'What is y?' }, ctx)).toBe(raw)
  })

  it('returns the summary with the raw result attached when the summarizer succeeds', async () => {
    vi.doMock('$lib/server/pb', () => ({
      pb: {
        collection: () => ({ getFirstListItem: () => Promise.resolve({ toolSummarizerModel: 'openai/test-model', updatedAt: '' }) }),
        filter: () => '',
      },
      getFirstOrNull: (p: Promise<unknown>) => p.catch(() => null),
    }))
    vi.doMock('$lib/server/api-key', () => ({ getDecryptedKey: async () => 'key' }))
    vi.doMock('$lib/server/providers', () => ({
      getProviderFactory: () => () => ({
        async *chat() {
          yield { type: 'text_delta', text: 'summarized briefing' }
        },
      }),
    }))
    const { withSearchSummarization } = await import('./summarize')
    const raw = `long ${'y'.repeat(5000)}`
    const wrapped = withSearchSummarization(makeTool(raw))
    const out = await wrapped.execute({ query: 'q', research_question: 'What is y?' }, ctx)
    expect(out).toEqual({ result: 'summarized briefing', rawResult: raw })
    vi.unmock('$lib/server/pb')
    vi.unmock('$lib/server/api-key')
    vi.unmock('$lib/server/providers')
  })
})
