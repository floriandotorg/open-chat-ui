import type { ConversationSummary } from '$lib/types/chat'
import { conversations, deleteConversation, setFavorite } from './conversations.svelte'
import { onSyncError } from './errors'
import { afterEach, describe, expect, it, vi } from 'vitest'

const summary = (id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: `Chat ${id}`,
  favorite: false,
  generating: false,
  systemPromptId: null,
  defaultModel: null,
  updatedAt: new Date(1000),
  ...overrides,
})

const originalFetch = globalThis.fetch

const stubFetch = (impl: () => Promise<Response>) => {
  const mock = vi.fn(impl)
  globalThis.fetch = Object.assign(mock, { preconnect: originalFetch.preconnect })
  return mock
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('conversations', () => {
  it('sorts by updatedAt descending', () => {
    conversations.reset([summary('a', { updatedAt: new Date(1000) }), summary('b', { updatedAt: new Date(3000) }), summary('c', { updatedAt: new Date(2000) })])

    expect(conversations.sorted.map(c => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('favorites instantly and keeps it once the server acknowledges', async () => {
    conversations.reset([summary('a')])
    const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }))

    const done = setFavorite('a', true)
    expect(conversations.get('a')?.favorite).toBe(true)
    await done

    expect(conversations.confirmed('a')?.favorite).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/a', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ favorite: true }) }))
  })

  it('reverts a failed favorite and reports why', async () => {
    const errors: string[] = []
    const stop = onSyncError(message => errors.push(message))
    conversations.reset([summary('a')])
    stubFetch(async () => new Response(JSON.stringify({ message: 'Nope' }), { status: 500 }))

    await setFavorite('a', true)
    stop()

    expect(conversations.get('a')?.favorite).toBe(false)
    expect(errors).toEqual(['Nope'])
  })

  it('hides a deleted conversation before the server answers', () => {
    conversations.reset([summary('a'), summary('b')])
    stubFetch(() => new Promise<Response>(() => {}))

    void deleteConversation('a')

    expect(conversations.sorted.map(c => c.id)).toEqual(['b'])
  })
})
