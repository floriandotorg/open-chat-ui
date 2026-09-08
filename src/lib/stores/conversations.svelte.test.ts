import type { ConversationSummary } from '$lib/types/chat'
import { ConversationsStore } from './conversations.svelte'
import { describe, expect, it } from 'vitest'

const summary = (id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: `Chat ${id}`,
  favorite: false,
  generating: false,
  systemPromptId: null,
  updatedAt: new Date(1000),
  ...overrides,
})

describe('ConversationsStore', () => {
  it('hydrates and sorts by updatedAt descending', () => {
    const store = new ConversationsStore()
    store.hydrate([summary('a', { updatedAt: new Date(1000) }), summary('b', { updatedAt: new Date(3000) }), summary('c', { updatedAt: new Date(2000) })])
    expect(store.conversations.map(c => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('upsert inserts new conversations and updates existing ones in place', () => {
    const store = new ConversationsStore()
    store.hydrate([summary('a')])
    store.upsert(summary('b', { updatedAt: new Date(2000) }))
    expect(store.conversations.map(c => c.id)).toEqual(['b', 'a'])

    store.upsert(summary('a', { title: 'Renamed' }))
    expect(store.conversations.length).toBe(2)
    expect(store.conversations.find(c => c.id === 'a')?.title).toBe('Renamed')
  })

  it('applyPatch is optimistic and survives stale server upserts until confirmed', () => {
    const store = new ConversationsStore()
    store.hydrate([summary('a')])

    store.applyPatch('a', { favorite: true })
    expect(store.conversations[0].favorite).toBe(true)

    store.upsert(summary('a', { favorite: false }))
    expect(store.conversations[0].favorite).toBe(true)

    store.upsert(summary('a', { favorite: true }))
    expect(store.conversations[0].favorite).toBe(true)
  })

  it('applyPatch on an unknown id is a no-op', () => {
    const store = new ConversationsStore()
    store.applyPatch('missing', { title: 'x' })
    expect(store.conversations.length).toBe(0)
  })

  it('applyTitle sets the title without blocking later server updates', () => {
    const store = new ConversationsStore()
    store.hydrate([summary('a')])

    store.applyTitle('a', 'Generated')
    expect(store.conversations[0].title).toBe('Generated')

    store.upsert(summary('a', { title: 'Server title' }))
    expect(store.conversations[0].title).toBe('Server title')
  })

  it('remove deletes the conversation and drops its pending patches', () => {
    const store = new ConversationsStore()
    store.hydrate([summary('a'), summary('b')])
    store.applyPatch('a', { favorite: true })

    store.remove('a')
    expect(store.conversations.map(c => c.id)).toEqual(['b'])

    store.upsert(summary('a'))
    expect(store.conversations.find(c => c.id === 'a')?.favorite).toBe(false)
  })

  it('hydrate keeps unconfirmed optimistic patches and clears confirmed ones', () => {
    const store = new ConversationsStore()
    store.hydrate([summary('a')])
    store.applyPatch('a', { title: 'Local' })

    store.hydrate([summary('a', { title: 'Old server' })])
    expect(store.conversations[0].title).toBe('Local')

    store.hydrate([summary('a', { title: 'Local' })])
    expect(store.conversations[0].title).toBe('Local')
  })
})
