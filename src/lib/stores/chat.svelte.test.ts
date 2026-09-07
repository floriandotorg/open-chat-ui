import type { Message } from '$lib/types'
import { createChatStore } from './chat.svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const flush = () => new Promise(r => setTimeout(r, 0))

const installFetch = (impl: (url: unknown, init?: RequestInit) => Promise<Response>) => {
  const mock = vi.fn(impl)
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

const okResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 })

describe('createChatStore (PocketBase realtime data plane)', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('adds the user message optimistically and points the branch at it', async () => {
    installFetch(async () => okResponse())

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello', undefined, [{ id: 'img-1.png', mimeType: 'image/png' }])
    await flush()

    expect(chat.allMessages.length).toBe(1)
    const userMsg = chat.allMessages[0]
    expect(userMsg.role).toBe('user')
    expect(userMsg.content).toBe('hello')
    expect(userMsg.images).toEqual([{ id: 'img-1.png', mimeType: 'image/png' }])
    expect(chat.activeBranches.__root__).toBe(userMsg.id)
    expect(chat.messages.map(m => m.id)).toContain(userMsg.id)
  })

  it('keeps the user message and marks it with sendError when POST /api/chat fails', async () => {
    installFetch(async () => new Response(JSON.stringify({ message: 'Simulated network failure' }), { status: 500 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    await flush()

    expect(chat.allMessages.length).toBe(1)
    expect(chat.allMessages[0].sendError).toBe('Simulated network failure')
    expect(chat.isStreaming).toBe(false)
  })

  it('falls back to a generic error message when the server returns no message body', async () => {
    installFetch(async () => new Response('not-json', { status: 502 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hi')
    await flush()

    expect(chat.allMessages[0].sendError).toBe('Request failed')
  })

  it('keeps the user message when fetch itself rejects (e.g. network drop)', async () => {
    installFetch(async () => {
      throw new TypeError('Load failed')
    })

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hi')
    await flush()

    expect(chat.allMessages.length).toBe(1)
    expect(chat.allMessages[0].sendError).toBe('Load failed')
  })

  it('reconciles the optimistic message when the realtime create event arrives', async () => {
    installFetch(async () => okResponse())

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    const optimistic = chat.allMessages[0]

    chat.upsertMessage({ ...optimistic, content: 'hello' })
    await flush()

    expect(chat.allMessages.length).toBe(1)
    expect(chat.allMessages[0].id).toBe(optimistic.id)
  })

  it('preserves sendError when a realtime upsert replaces the failed user message', async () => {
    installFetch(async () => new Response(JSON.stringify({ message: 'Overloaded' }), { status: 500 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hi')
    const failed = chat.allMessages[0]
    expect(failed.sendError).toBe('Overloaded')

    chat.upsertMessage({ ...failed, sendError: undefined })

    expect(chat.allMessages[0].sendError).toBe('Overloaded')
  })

  it('exposes the generating assistant record as the streaming message while realtime flushes arrive', async () => {
    installFetch(async () => okResponse())

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    const userMsg = chat.allMessages[0]
    expect(chat.isStreaming).toBe(true)

    chat.upsertMessage({
      id: 'srv-assist-1',
      conversationId: 'conv-1',
      parentId: userMsg.id,
      role: 'assistant',
      content: 'partial ',
      generating: true,
      createdAt: new Date(),
    })
    expect(chat.isStreaming).toBe(true)
    expect(chat.streamingMessage?.content).toBe('partial ')

    chat.upsertMessage({
      id: 'srv-assist-1',
      conversationId: 'conv-1',
      parentId: userMsg.id,
      role: 'assistant',
      content: 'partial answer',
      generating: true,
      createdAt: new Date(),
    })
    expect(chat.streamingMessage?.content).toBe('partial answer')

    chat.upsertMessage({
      id: 'srv-assist-1',
      conversationId: 'conv-1',
      parentId: userMsg.id,
      role: 'assistant',
      content: 'partial answer',
      generating: false,
      createdAt: new Date(),
    })
    expect(chat.isStreaming).toBe(false)
    expect(chat.streamingMessage).toBeUndefined()
    expect(chat.allMessages.length).toBe(2)
  })

  it('queues messages while streaming and drains the queue once generation ends', async () => {
    const bodies: unknown[] = []
    installFetch(async (_url, init) => {
      bodies.push(init?.body ? JSON.parse(init.body as string) : null)
      return okResponse()
    })

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'first')
    expect(chat.isStreaming).toBe(true)

    await chat.sendMessage('conv-1', 'second')
    expect(chat.messageQueue.length).toBe(1)
    expect(bodies.length).toBe(1)

    const assistantBase = {
      id: 'srv-assist-1',
      conversationId: 'conv-1',
      parentId: chat.allMessages[0].id,
      role: 'assistant' as const,
      content: 'answer',
      createdAt: new Date(),
    }
    chat.upsertMessage({ ...assistantBase, generating: true })
    chat.setConversationGenerating(true)
    chat.upsertMessage({ ...assistantBase, generating: false })
    chat.setConversationGenerating(false)
    await flush()
    await flush()

    expect(chat.messageQueue.length).toBe(0)
    expect(bodies.length).toBe(2)
    expect((bodies[1] as { message: string }).message).toBe('second')
  })

  it('keeps the optimistic branch selection when a stale conversation update arrives before the server confirms', async () => {
    installFetch(async () => okResponse())

    const chat = createChatStore({
      allMessages: [
        { id: 'a1', conversationId: 'conv-1', parentId: null, role: 'assistant', content: 'one', createdAt: new Date(1) },
        { id: 'a2', conversationId: 'conv-1', parentId: null, role: 'assistant', content: 'two', createdAt: new Date(2) },
      ],
      activeBranches: { __root__: 'a1' },
    })

    await chat.switchBranch('conv-1', '__root__', 'a2')
    expect(chat.activeBranches.__root__).toBe('a2')

    chat.applyServerBranches({ __root__: 'a1' })
    expect(chat.activeBranches.__root__).toBe('a2')

    chat.applyServerBranches({ __root__: 'a2' })
    expect(chat.activeBranches.__root__).toBe('a2')

    chat.applyServerBranches({ __root__: 'a1' })
    expect(chat.activeBranches.__root__).toBe('a1')
  })

  it('discardFailedMessage removes the failed message, clears its branch entry, and ignores late realtime upserts for it', async () => {
    installFetch(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hi')
    const failedId = chat.allMessages[0].id
    expect(Object.values(chat.activeBranches)).toContain(failedId)

    chat.discardFailedMessage(failedId)

    expect(chat.allMessages.length).toBe(0)
    expect(Object.values(chat.activeBranches)).not.toContain(failedId)

    chat.upsertMessage({ id: failedId, conversationId: 'conv-1', parentId: null, role: 'user', content: 'hi', createdAt: new Date() })
    expect(chat.allMessages.length).toBe(0)
  })

  it('retryFailedMessage re-posts a pending (never persisted) message without skipUserInsert', async () => {
    const bodies: Record<string, unknown>[] = []
    let calls = 0
    installFetch(async (_url, init) => {
      ++calls
      bodies.push(init?.body ? JSON.parse(init.body as string) : null)
      if (calls === 1) return new Response(JSON.stringify({ message: 'first failure' }), { status: 500 })
      return okResponse()
    })

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'retry me', undefined, [{ id: 'img.png', mimeType: 'image/png' }], [{ id: 'f.csv', filename: 'f.csv', mimeType: 'text/csv' }])
    const failedId = chat.allMessages[0].id
    expect(chat.allMessages[0].sendError).toBe('first failure')

    await chat.retryFailedMessage('conv-1', failedId)

    expect(bodies.length).toBe(2)
    const retryBody = bodies[1]
    expect(retryBody.userMsgId).toBe(failedId)
    expect(retryBody.skipUserInsert).toBe(false)
    expect(retryBody.message).toBe('retry me')
    expect(chat.allMessages[0].sendError).toBeUndefined()
  })

  it('retryFailedMessage re-triggers generation with skipUserInsert for a persisted message', async () => {
    const bodies: Record<string, unknown>[] = []
    installFetch(async (_url, init) => {
      bodies.push(init?.body ? JSON.parse(init.body as string) : null)
      return okResponse()
    })

    const chat = createChatStore({
      allMessages: [{ id: 'user-1', conversationId: 'conv-1', parentId: null, role: 'user', content: 'hi', sendError: 'Overloaded', createdAt: new Date() }],
      activeBranches: { __root__: 'user-1' },
    })
    chat.selectedModel = 'anthropic/claude-test'

    await chat.retryFailedMessage('conv-1', 'user-1')

    expect(bodies.length).toBe(1)
    expect(bodies[0].userMsgId).toBe('user-1')
    expect(bodies[0].skipUserInsert).toBe(true)
    expect(chat.isStreaming).toBe(true)
  })

  it('editMessage creates an optimistic branched user message and triggers generation', async () => {
    const urls: string[] = []
    const bodies: Record<string, unknown>[] = []
    installFetch(async (url, init) => {
      urls.push(String(url))
      bodies.push(init?.body ? JSON.parse(init.body as string) : null)
      return okResponse()
    })

    const chat = createChatStore({
      allMessages: [
        { id: 'user-1', conversationId: 'conv-1', parentId: null, role: 'user', content: 'original', createdAt: new Date(1) },
        { id: 'asst-1', conversationId: 'conv-1', parentId: 'user-1', role: 'assistant', content: 'answer', createdAt: new Date(2) },
      ],
      activeBranches: { __root__: 'user-1', 'user-1': 'asst-1' },
    })
    chat.selectedModel = 'anthropic/claude-test'

    await chat.editMessage('conv-1', 'user-1', 'edited')

    expect(urls).toEqual(['/api/chat/edit', '/api/chat'])
    expect(chat.allMessages.length).toBe(3)
    const newMsg = chat.allMessages.find(m => m.content === 'edited')
    expect(newMsg?.parentId).toBeNull()
    expect(chat.activeBranches.__root__).toBe(newMsg?.id)
    expect(bodies[0].newMessageId).toBe(newMsg?.id)
    expect(bodies[1].userMsgId).toBe(newMsg?.id)
    expect(bodies[1].skipUserInsert).toBe(true)
  })

  it('regenerateMessage triggers generation and clears the busy flag on failure', async () => {
    let calls = 0
    installFetch(async () => {
      ++calls
      if (calls === 1) return okResponse()
      return new Response(JSON.stringify({ message: 'regen failed' }), { status: 500 })
    })

    const chat = createChatStore({
      allMessages: [
        { id: 'user-1', conversationId: 'conv-1', parentId: null, role: 'user', content: 'hi', createdAt: new Date(1) },
        { id: 'asst-1', conversationId: 'conv-1', parentId: 'user-1', role: 'assistant', content: 'answer', createdAt: new Date(2) },
      ],
      activeBranches: { __root__: 'user-1', 'user-1': 'asst-1' },
    })
    chat.selectedModel = 'anthropic/claude-test'

    await chat.regenerateMessage('conv-1', 'asst-1')
    expect(chat.isStreaming).toBe(true)

    chat.upsertMessage({ id: 'asst-2', conversationId: 'conv-1', parentId: 'user-1', role: 'assistant', content: '', generating: true, createdAt: new Date(3) })
    chat.upsertMessage({ id: 'asst-2', conversationId: 'conv-1', parentId: 'user-1', role: 'assistant', content: 'new answer', generating: false, createdAt: new Date(3) })
    chat.setConversationGenerating(false)
    expect(chat.isStreaming).toBe(false)

    await expect(chat.regenerateMessage('conv-1', 'asst-2')).rejects.toThrow()
    expect(chat.isStreaming).toBe(false)
  })

  it('stopStreaming posts a stop command and clears the queue', async () => {
    const mock = installFetch(async () => okResponse())

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    chat.stopStreaming()

    const stopCall = mock.mock.calls.find(c => String(c[0]) === '/api/chat/stop')
    expect(stopCall).toBeDefined()
    expect(chat.isStreaming).toBe(false)
  })

  it('seed replaces confirmed messages on navigation but keeps pending sends of that conversation', async () => {
    installFetch(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 }))

    const chat = createChatStore({
      allMessages: [{ id: 'm1', conversationId: 'conv-1', parentId: null, role: 'user', content: 'old', createdAt: new Date() }],
      activeBranches: { __root__: 'm1' },
    })
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'unsent')
    expect(chat.allMessages.length).toBe(2)

    chat.seed('conv-1', [{ id: 'm1', conversationId: 'conv-1', parentId: null, role: 'user', content: 'old', createdAt: new Date() }], { __root__: 'm1' })
    expect(chat.allMessages.length).toBe(2)

    chat.seed('conv-2', [], {})
    expect(chat.allMessages.length).toBe(0)
  })

  it('seed resets the busy flag when navigating to a different conversation mid-generation', async () => {
    installFetch(async () => okResponse())

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    expect(chat.isStreaming).toBe(true)

    chat.seed('conv-2', [], {})
    expect(chat.isStreaming).toBe(false)
  })
})

describe('stream events', () => {
  const streamingAssistant = (overrides: Partial<Message> = {}): Message => ({
    id: 'assist-1',
    conversationId: 'conv-1',
    parentId: null,
    role: 'assistant',
    content: '',
    generating: true,
    eventSeq: 0,
    createdAt: new Date(),
    ...overrides,
  })

  it('applies text ops on top of the confirmed snapshot', async () => {
    installFetch(async () => okResponse())
    const chat = createChatStore({ allMessages: [streamingAssistant()], activeBranches: {} })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'he' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'llo' }] })
    await flush()

    expect(chat.allMessages[0].content).toBe('hello')
    expect(chat.streamingMessage?.content).toBe('hello')
  })

  it('buffers out-of-order events, fetches the gap once, and applies after fill', async () => {
    installFetch(async () => okResponse())
    const fetches: { from: number; to: number | null }[] = []
    const chat = createChatStore(
      { allMessages: [streamingAssistant()], activeBranches: {} },
      {
        fetchStreamEvents: async (_messageId, from, to) => {
          fetches.push({ from, to })
          return [{ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'a' }] }]
        },
      },
    )

    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'b' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 3, ops: [{ t: 'text', v: 'c' }] })
    expect(chat.allMessages[0].content).toBe('')
    await flush()

    expect(fetches).toEqual([{ from: 1, to: 1 }])
    expect(chat.allMessages[0].content).toBe('abc')
  })

  it('drops ops folded into a snapshot via eventSeq', async () => {
    installFetch(async () => okResponse())
    const chat = createChatStore({ allMessages: [streamingAssistant()], activeBranches: {} })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'he' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'llo' }] })
    expect(chat.allMessages[0].content).toBe('hello')

    chat.upsertMessage(streamingAssistant({ content: 'hello', eventSeq: 2 }))
    expect(chat.allMessages[0].content).toBe('hello')

    chat.ingestEvent({ messageId: 'assist-1', seq: 3, ops: [{ t: 'text', v: '!' }] })
    expect(chat.allMessages[0].content).toBe('hello!')
  })

  it('ignores events already folded into the snapshot', async () => {
    installFetch(async () => okResponse())
    const chat = createChatStore({ allMessages: [streamingAssistant({ content: 'hello', eventSeq: 2 })], activeBranches: {} })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'he' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'llo' }] })
    await flush()

    expect(chat.allMessages[0].content).toBe('hello')
  })

  it('clears live state when the final snapshot arrives and ignores late events', async () => {
    installFetch(async () => okResponse())
    const chat = createChatStore({ allMessages: [streamingAssistant()], activeBranches: {} })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'hi' }] })
    expect(chat.allMessages[0].content).toBe('hi')

    chat.upsertMessage(streamingAssistant({ content: 'hi', generating: false, eventSeq: 1 }))
    expect(chat.isStreaming).toBe(false)
    expect(chat.allMessages[0].content).toBe('hi')

    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'stale' }] })
    expect(chat.allMessages[0].content).toBe('hi')
  })

  it('buffers events for an unknown message and applies them when the placeholder arrives', async () => {
    installFetch(async () => okResponse())
    const chat = createChatStore({ allMessages: [], activeBranches: {} })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'early' }] })
    expect(chat.allMessages.length).toBe(0)

    chat.upsertMessage(streamingAssistant())
    expect(chat.allMessages[0].content).toBe('early')
  })

  it('clears live state on seed', async () => {
    installFetch(async () => okResponse())
    const chat = createChatStore({ allMessages: [streamingAssistant()], activeBranches: {} })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'hi' }] })
    expect(chat.allMessages[0].content).toBe('hi')

    chat.seed('conv-1', [streamingAssistant({ content: 'hi', eventSeq: 1 })], {})
    expect(chat.allMessages[0].content).toBe('hi')
  })

  it('clears awaitingGeneration when the first event arrives', async () => {
    installFetch(async () => okResponse())
    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'
    await chat.sendMessage('conv-1', 'hello')
    expect(chat.awaitingGeneration).toBe(true)

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'hi' }] })
    expect(chat.awaitingGeneration).toBe(false)
  })
})
