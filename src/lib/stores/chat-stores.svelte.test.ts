import { SyncCollection } from '$lib/sync/collection.svelte'
import { type ConversationStateRecord, ConversationsCollection } from '$lib/sync/conversations.svelte'
import type { ChatMessage, ConversationSummary } from '$lib/types/chat'
import { ChatStore, type RequestFn } from './chat.svelte'
import { ChatStores, type ConversationDetail } from './chat-stores.svelte'
import { error } from '@sveltejs/kit'
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

const summary = (id: string): ConversationSummary => ({ id, title: 'New Chat', favorite: false, generating: false, systemPromptId: 'prompt-1', defaultModel: null, updatedAt: new Date() })

const detail = (id: string, messages: ChatMessage[] = [], generating = false): ConversationDetail => ({
  conversation: { id, generating, activeBranches: {} },
  messages,
})

// Tests own the response shape of the endpoints they fake.
const respondWith = (impl: () => Promise<unknown>): RequestFn => impl as RequestFn

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}
  let reject: (err: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Options {
  currentId?: string
  capacity?: number
  fetchDetail?: (id: string) => Promise<ConversationDetail>
  request?: () => Promise<unknown>
}

const setup = (options: Options = {}) => {
  const conversations = new ConversationsCollection()
  const conversationStates = new SyncCollection<ConversationStateRecord>()
  const fetchDetail = vi.fn(options.fetchDetail ?? (async (id: string) => detail(id, [message({ id: `${id}-m`, conversationId: id })])))
  const stores = new ChatStores({
    fetchDetail,
    createStore: id => new ChatStore(id, { conversations, conversationStates, request: respondWith(options.request ?? (async () => ({}))), fetchStreamEvents: async () => [], fetchMessage: async () => null }),
    currentId: () => options.currentId,
    capacity: options.capacity,
  })
  const load = async (id: string) => {
    const store = stores.ensure(id)
    await stores.whenLoaded(id)
    return store
  }
  return { stores, fetchDetail, load, conversations, conversationStates }
}

describe('ChatStores', () => {
  it('hands out a loading store synchronously and seeds it when the detail arrives', async () => {
    const pending = deferred<ConversationDetail>()
    const { stores, fetchDetail } = setup({ fetchDetail: () => pending.promise })

    const store = stores.ensure('conv-1')
    expect(store.status).toBe('loading')
    expect(stores.peek('conv-1')).toBe(store)

    pending.resolve(detail('conv-1', [message({ id: 'conv-1-m' })]))
    await stores.whenLoaded('conv-1')

    expect(store.status).toBe('ready')
    expect(store.allMessages.map(m => m.id)).toEqual(['conv-1-m'])
    expect(fetchDetail).toHaveBeenCalledTimes(1)
  })

  it('serves a cached store without fetching again', async () => {
    const { stores, load, fetchDetail } = setup()

    const first = await load('conv-1')

    expect(stores.ensure('conv-1')).toBe(first)
    expect(fetchDetail).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight fetch between concurrent requests', async () => {
    const { stores, fetchDetail } = setup()

    expect(stores.ensure('conv-1')).toBe(stores.ensure('conv-1'))
    await stores.whenLoaded('conv-1')

    expect(fetchDetail).toHaveBeenCalledTimes(1)
  })

  it('marks missing conversations and retries failed loads on the next visit', async () => {
    let attempt = 0
    const { stores } = setup({
      fetchDetail: async id => {
        if (id === 'gone') {
          throw error(404, 'Conversation not found')
        }
        if (++attempt === 1) {
          throw new Error('offline')
        }
        return detail(id)
      },
    })

    const gone = stores.ensure('gone')
    const flaky = stores.ensure('conv-1')
    await Promise.all([stores.whenLoaded('gone'), stores.whenLoaded('conv-1')])
    expect([gone.status, flaky.status]).toEqual(['missing', 'error'])

    stores.ensure('conv-1')
    await stores.whenLoaded('conv-1')
    expect(flaky.status).toBe('ready')
  })

  it('creates an empty store that creates the conversation on first send', async () => {
    const request = vi.fn(async () => ({}))
    const { stores, conversations } = setup({ request })

    const store = stores.createEmpty(summary('conv-new'))
    await store.sendMessage('hi')

    expect(stores.peek('conv-new')).toBe(store)
    expect(store.allMessages[0].content).toBe('hi')
    expect(conversations.get('conv-new')?.systemPromptId).toBe('prompt-1')
    expect(request).toHaveBeenCalledWith('/api/chat', expect.objectContaining({ conversationId: 'conv-new', createConversation: { systemPromptId: 'prompt-1' } }))
  })

  it('keeps stores reactive after the component that created them is destroyed', () => {
    const { stores } = setup()
    let store: ChatStore | undefined
    const destroyOwner = $effect.root(() => {
      $effect(() => {
        store = stores.createEmpty(summary('conv-new'))
      })
    })
    flushSync()
    destroyOwner()

    stores.routeMessage(message({ conversationId: 'conv-new' }))

    expect(store?.allMessages.map(m => m.id)).toEqual(['msg-1'])
  })

  it('routes realtime messages and stream events to the matching store only', async () => {
    const { stores, load } = setup()
    const one = await load('conv-1')
    const two = await load('conv-2')

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

    const store = stores.ensure('conv-1')
    stores.routeMessage(message({ id: 'a-1', role: 'assistant', content: 'done', generating: false, eventSeq: 3 }))
    pending.resolve(detail('conv-1', [message({ id: 'a-1', role: 'assistant', content: 'do', generating: true, eventSeq: 1 })], true))
    await stores.whenLoaded('conv-1')

    expect(store.allMessages[0]).toMatchObject({ content: 'done', generating: false })
  })

  it('removes deleted messages from the matching store', async () => {
    const { stores, load } = setup()
    const store = await load('conv-1')

    stores.removeMessage('conv-1', 'conv-1-m')

    expect(store.allMessages).toEqual([])
  })

  it('reads branch pointers and the generation flag from the shared conversation state', async () => {
    const { load, conversationStates } = setup()
    const store = await load('conv-1')

    conversationStates.receive({ id: 'conv-1', generating: true, activeBranches: { __root__: 'conv-1-m' } })

    expect(store.isStreaming).toBe(true)
    expect(store.activeBranches).toEqual({ __root__: 'conv-1-m' })
  })

  it('revalidates the current store immediately and the others on their next visit after a reconnect', async () => {
    const { stores, load, fetchDetail } = setup({ currentId: 'conv-1' })
    await load('conv-1')
    await load('conv-2')
    fetchDetail.mockClear()

    stores.markStale()
    await flush()
    expect(fetchDetail.mock.calls.map(c => c[0])).toEqual(['conv-1'])

    stores.ensure('conv-2')
    await flush()
    expect(fetchDetail.mock.calls.map(c => c[0])).toEqual(['conv-1', 'conv-2'])
  })

  it('evicts the least recently used store but keeps the current and streaming ones', async () => {
    const { stores, load, conversationStates } = setup({ currentId: 'conv-1', capacity: 2 })
    const current = await load('conv-1')
    const streaming = await load('conv-2')
    conversationStates.receive({ id: 'conv-2', generating: true, activeBranches: {} })
    const idle = await load('conv-3')
    const dispose = vi.spyOn(idle, 'dispose')
    await load('conv-4')

    expect(stores.peek('conv-1')).toBe(current)
    expect(stores.peek('conv-2')).toBe(streaming)
    expect(stores.peek('conv-3')).toBeUndefined()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('prefetches only conversations that are not cached yet', async () => {
    const { stores, load, fetchDetail } = setup()
    await load('conv-1')
    fetchDetail.mockClear()

    stores.prefetch(['conv-1', 'conv-2'])
    await flush()

    expect(fetchDetail.mock.calls.map(c => c[0])).toEqual(['conv-2'])
  })
})
