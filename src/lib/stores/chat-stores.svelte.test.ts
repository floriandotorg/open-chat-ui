import type { ChatMessage } from '$lib/types/chat'
import { ChatStore } from './chat.svelte'
import { ChatStores, type ConversationDetail } from './chat-stores.svelte'
import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

const flush = () => new Promise(r => setTimeout(r, 0))

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  conversationId: 'conv-1',
  parentId: null,
  role: 'user',
  content: 'hello',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
})

const detail = (id: string, messages: ChatMessage[] = [], generating = false): ConversationDetail => ({
  conversation: { id, generating, activeBranches: {} },
  messages,
})

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

const setup = (options: { currentId?: string; capacity?: number; fetchDetail?: (id: string) => Promise<ConversationDetail> } = {}) => {
  const fetchDetail = vi.fn(options.fetchDetail ?? (async (id: string) => detail(id, [message({ id: `${id}-m`, conversationId: id })])))
  const stores = new ChatStores({
    fetchDetail,
    createStore: () => new ChatStore({ fetchStreamEvents: async () => [] }),
    currentId: () => options.currentId,
    capacity: options.capacity,
  })
  return { stores, fetchDetail }
}

describe('ChatStores', () => {
  it('fetches and seeds a store on first acquire', async () => {
    const { stores, fetchDetail } = setup()

    const store = await stores.acquire('conv-1')

    expect(fetchDetail).toHaveBeenCalledTimes(1)
    expect(store.allMessages.map(m => m.id)).toEqual(['conv-1-m'])
    expect(stores.peek('conv-1')).toBe(store)
  })

  it('serves a cached store without fetching again', async () => {
    const { stores, fetchDetail } = setup()

    const first = await stores.acquire('conv-1')
    const second = await stores.acquire('conv-1')

    expect(second).toBe(first)
    expect(fetchDetail).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight fetch between concurrent acquires', async () => {
    const { stores, fetchDetail } = setup()

    const [a, b] = await Promise.all([stores.acquire('conv-1'), stores.acquire('conv-1')])

    expect(a).toBe(b)
    expect(fetchDetail).toHaveBeenCalledTimes(1)
  })

  it('creates an empty store that creates the conversation on first send', async () => {
    const request = vi.fn(async () => ({}))
    const stores = new ChatStores({
      fetchDetail: vi.fn(),
      createStore: () => new ChatStore({ request: request as never, fetchStreamEvents: async () => [] }),
      currentId: () => undefined,
    })

    const store = stores.createEmpty('conv-new', 'prompt-1')
    await store.sendMessage('conv-new', 'hi')
    await store.sendMessage('conv-new', 'queued')

    expect(stores.peek('conv-new')).toBe(store)
    expect(store.allMessages[0].content).toBe('hi')
    expect(request).toHaveBeenCalledWith('/api/chat', expect.objectContaining({ conversationId: 'conv-new', createConversation: { systemPromptId: 'prompt-1' } }))
  })

  it('keeps stores reactive after the component that created them is destroyed', async () => {
    const { stores } = setup()
    let store: ChatStore | undefined
    const destroyOwner = $effect.root(() => {
      $effect(() => {
        store = stores.createEmpty('conv-new', null)
      })
    })
    flushSync()
    destroyOwner()

    stores.routeMessage(message({ conversationId: 'conv-new' }))

    expect(store?.allMessages.map(m => m.id)).toEqual(['msg-1'])
  })

  it('routes realtime messages and stream events to the matching store only', async () => {
    const { stores } = setup()
    const one = await stores.acquire('conv-1')
    const two = await stores.acquire('conv-2')

    stores.routeMessage(message({ id: 'a-1', conversationId: 'conv-1', role: 'assistant', content: '', generating: true, eventSeq: 0 }))
    stores.routeEvent('conv-1', { messageId: 'a-1', seq: 1, ops: [{ t: 'text', v: 'hi' }] })
    stores.routeMessage(message({ id: 'x-1', conversationId: 'conv-unknown' }))

    expect(one.allMessages.find(m => m.id === 'a-1')?.content).toBe('hi')
    expect(two.allMessages.some(m => m.id === 'a-1')).toBe(false)
    expect(stores.peek('conv-unknown')).toBeUndefined()
  })

  it('applies realtime updates that arrive while the initial fetch is in flight', async () => {
    const pending = deferred<ConversationDetail>()
    const { stores } = setup({ fetchDetail: () => pending.promise })

    const acquiring = stores.acquire('conv-1')
    stores.routeMessage(message({ id: 'a-1', role: 'assistant', content: 'done', generating: false, eventSeq: 3 }))
    pending.resolve(detail('conv-1', [message({ id: 'a-1', role: 'assistant', content: 'do', generating: true, eventSeq: 1 })], true))
    const store = await acquiring

    expect(store.allMessages[0].content).toBe('done')
    expect(store.allMessages[0].generating).toBe(false)
  })

  it('removes deleted messages from the matching store', async () => {
    const { stores } = setup()
    const store = await stores.acquire('conv-1')

    stores.removeMessage('conv-1', 'conv-1-m')

    expect(store.allMessages).toEqual([])
  })

  it('applies conversation updates to the matching store', async () => {
    const { stores } = setup()
    const store = await stores.acquire('conv-1')

    stores.routeConversation('conv-1', { generating: true, activeBranches: { __root__: 'conv-1-m' } })

    expect(store.isStreaming).toBe(true)
    expect(store.activeBranches).toEqual({ __root__: 'conv-1-m' })
  })

  it('revalidates the current store immediately and the others on their next acquire after a reconnect', async () => {
    const { stores, fetchDetail } = setup({ currentId: 'conv-1' })
    await stores.acquire('conv-1')
    await stores.acquire('conv-2')
    fetchDetail.mockClear()

    stores.markStale()
    await flush()
    expect(fetchDetail.mock.calls.map(c => c[0])).toEqual(['conv-1'])

    await stores.acquire('conv-2')
    await flush()
    expect(fetchDetail.mock.calls.map(c => c[0])).toEqual(['conv-1', 'conv-2'])
  })

  it('evicts the least recently used store but keeps the current and streaming ones', async () => {
    const { stores } = setup({ currentId: 'conv-1', capacity: 2 })
    const current = await stores.acquire('conv-1')
    const streaming = await stores.acquire('conv-2')
    stores.routeConversation('conv-2', { generating: true, activeBranches: {} })
    const idle = await stores.acquire('conv-3')
    const dispose = vi.spyOn(idle, 'dispose')
    await stores.acquire('conv-4')

    expect(stores.peek('conv-1')).toBe(current)
    expect(stores.peek('conv-2')).toBe(streaming)
    expect(stores.peek('conv-3')).toBeUndefined()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('prefetches only conversations that are not cached yet', async () => {
    const { stores, fetchDetail } = setup()
    await stores.acquire('conv-1')
    fetchDetail.mockClear()

    stores.prefetch(['conv-1', 'conv-2'])
    await flush()

    expect(fetchDetail.mock.calls.map(c => c[0])).toEqual(['conv-2'])
  })
})
