import { afterEach, describe, expect, it, vi } from 'vitest'

const mockFetch = (data: Record<string, unknown>) => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(data))) as unknown as typeof fetch
}

describe('getKnowledgeCutoff', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns the knowledge field for a known model', async () => {
    mockFetch({ 'anthropic/claude-opus-4-1': { knowledge: '2025-03-31' } })
    const { getKnowledgeCutoff } = await import('./knowledge-cutoff')
    expect(await getKnowledgeCutoff('anthropic/claude-opus-4-1')).toBe('2025-03-31')
  })

  it('returns undefined when the model has no knowledge field', async () => {
    mockFetch({ 'xai/grok-4.3': {} })
    const { getKnowledgeCutoff } = await import('./knowledge-cutoff')
    expect(await getKnowledgeCutoff('xai/grok-4.3')).toBeUndefined()
  })

  it('returns undefined for an unknown model ref', async () => {
    mockFetch({ 'anthropic/claude-opus-4-1': { knowledge: '2025-03-31' } })
    const { getKnowledgeCutoff } = await import('./knowledge-cutoff')
    expect(await getKnowledgeCutoff('unknown/model')).toBeUndefined()
  })

  it('caches the response and does not refetch on subsequent calls', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ 'a/b': { knowledge: '2024-01' } })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { getKnowledgeCutoff } = await import('./knowledge-cutoff')
    await getKnowledgeCutoff('a/b')
    await getKnowledgeCutoff('a/b')
    await getKnowledgeCutoff('a/c')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed fetch', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ 'a/b': { knowledge: '2024-01' } })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { getKnowledgeCutoff } = await import('./knowledge-cutoff')
    await expect(getKnowledgeCutoff('a/b')).rejects.toThrow('network down')
    expect(await getKnowledgeCutoff('a/b')).toBe('2024-01')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
