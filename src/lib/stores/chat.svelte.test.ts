import type { BranchMap } from '$lib/message-tree'
import { SyncCollection } from '$lib/sync/collection.svelte'
import { type ConversationStateRecord, ConversationsCollection } from '$lib/sync/conversations.svelte'
import { onSyncError } from '$lib/sync/errors'
import type { ChatMessage, ConversationSummary } from '$lib/types/chat'
import { ChatStore, type ChatStoreDeps, type RequestFn } from './chat.svelte'
import { afterEach, describe, expect, it } from 'vitest'

const flush = () => new Promise(r => setTimeout(r, 0))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const summary = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'conv-1',
  title: 'New Chat',
  favorite: false,
  generating: false,
  systemPromptId: null,
  defaultModel: null,
  updatedAt: new Date(0),
  ...overrides,
})

const message = (overrides: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  conversationId: 'conv-1',
  parentId: null,
  role: 'user',
  content: '',
  createdAt: new Date(1),
  ...overrides,
})

const assistant = (overrides: Partial<ChatMessage> = {}): ChatMessage => message({ id: 'assist-1', role: 'assistant', generating: true, eventSeq: 0, ...overrides })

type Handler = (path: string, body: Record<string, unknown>) => unknown

// Handlers own the response shape of the endpoint they fake.
const fakeRequest = (handler: Handler): RequestFn => (async (path: string, body: Record<string, unknown>) => handler(path, body)) as RequestFn

const deferred = () => {
  let resolve: (value: unknown) => void = () => {}
  let reject: (err: Error) => void = () => {}
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const created: ChatStore[] = []

afterEach(() => {
  for (const store of created.splice(0)) {
    store.dispose()
  }
})

interface Setup extends Omit<ChatStoreDeps, 'request'> {
  messages?: ChatMessage[]
  branches?: BranchMap
  generating?: boolean
  handler?: Handler
  seeded?: boolean
}

const setup = ({ messages = [], branches = {}, generating = false, handler = () => ({}), seeded = true, ...deps }: Setup = {}) => {
  const conversations = new ConversationsCollection()
  const conversationStates = new SyncCollection<ConversationStateRecord>()
  const calls: { path: string; body: Record<string, unknown> }[] = []
  let n = 0
  conversations.reset([summary()])
  const chat = new ChatStore('conv-1', {
    conversations,
    conversationStates,
    id: () => `id-${++n}`,
    now: () => new Date(1000 + n),
    fetchMessage: async () => null,
    fetchStreamEvents: async () => [],
    request: fakeRequest((path, body) => {
      calls.push({ path, body })
      return handler(path, body)
    }),
    ...deps,
  })
  if (seeded) {
    chat.seed({ conversation: { id: 'conv-1', generating, activeBranches: branches }, messages })
  }
  chat.selectedModel = 'anthropic/claude-test'
  created.push(chat)
  const chatCalls = () => calls.filter(c => c.path === '/api/chat')
  return { chat, conversations, conversationStates, calls, chatCalls }
}

describe('sending', () => {
  it('renders the user message and the assistant placeholder before the request resolves', () => {
    const pending = deferred()
    const { chat, chatCalls } = setup({ handler: () => pending.promise })

    void chat.sendMessage('hello', [{ id: 'img-1.png', mimeType: 'image/png' }])

    const [user, placeholder] = chat.messages
    expect(user).toMatchObject({ role: 'user', content: 'hello', images: [{ id: 'img-1.png', mimeType: 'image/png' }] })
    expect(placeholder).toMatchObject({ role: 'assistant', parentId: user.id, generating: true, content: '' })
    expect(chat.activeBranches).toEqual({ __root__: user.id, [user.id]: placeholder.id })
    expect(chat.isStreaming).toBe(true)
    expect(chatCalls()[0].body).toMatchObject({ userMsgId: user.id, assistantMsgId: placeholder.id, parentId: null, skipUserInsert: false })
  })

  it('moves the conversation to the top of the sidebar instantly', () => {
    const { chat, conversations } = setup({ handler: () => new Promise(() => {}) })

    void chat.sendMessage('hello')

    expect(conversations.get('conv-1')?.updatedAt.getTime()).toBeGreaterThan(0)
  })

  it('keeps the user message with its error and drops the placeholder when the send fails', async () => {
    const { chat } = setup({
      handler: () => {
        throw new Error('Simulated network failure')
      },
    })

    await chat.sendMessage('hello')

    expect(chat.allMessages.map(m => [m.role, m.sendError])).toEqual([['user', 'Simulated network failure']])
    expect(chat.isStreaming).toBe(false)
  })

  it('does not duplicate the optimistic message when the realtime echo arrives', async () => {
    const { chat } = setup()

    await chat.sendMessage('hello')
    const [user] = chat.allMessages
    chat.upsertMessage({ ...user, content: 'hello' })

    expect(chat.allMessages.filter(m => m.role === 'user')).toHaveLength(1)
  })

  it('preserves sendError when a realtime upsert replaces the failed user message', async () => {
    const { chat } = setup({
      handler: () => {
        throw new Error('Overloaded')
      },
    })

    await chat.sendMessage('hi')
    const [failed] = chat.allMessages
    chat.upsertMessage({ ...failed, sendError: undefined })

    expect(chat.allMessages[0].sendError).toBe('Overloaded')
  })

  it('streams server snapshots of the placeholder and settles on the final one', async () => {
    const { chat, chatCalls } = setup()

    await chat.sendMessage('hello')
    const assistantId = String(chatCalls()[0].body.assistantMsgId)
    const userId = String(chatCalls()[0].body.userMsgId)

    chat.upsertMessage(assistant({ id: assistantId, parentId: userId, content: 'partial ', eventSeq: 1 }))
    expect(chat.streamingMessage?.content).toBe('partial ')

    chat.upsertMessage(assistant({ id: assistantId, parentId: userId, content: 'partial answer', eventSeq: 2, generating: false }))
    expect(chat.isStreaming).toBe(false)
    expect(chat.allMessages).toHaveLength(2)
  })

  it('queues messages while streaming and drains the queue once generation ends', async () => {
    const { chat, chatCalls } = setup()

    await chat.sendMessage('first')
    await chat.sendMessage('second')
    expect(chat.messageQueue).toHaveLength(1)
    expect(chatCalls()).toHaveLength(1)

    const { assistantMsgId, userMsgId } = chatCalls()[0].body
    chat.upsertMessage(assistant({ id: String(assistantMsgId), parentId: String(userMsgId), content: 'answer', generating: false, eventSeq: 1 }))
    await flush()
    await flush()

    expect(chat.messageQueue).toHaveLength(0)
    expect(chatCalls().map(c => c.body.message)).toEqual(['first', 'second'])
    expect(chatCalls()[1].body.parentId).toBe(assistantMsgId)
  })

  it('queues sends until the conversation finished loading', async () => {
    const { chat, chatCalls } = setup({ seeded: false })
    chat.status = 'loading'

    await chat.sendMessage('early')
    expect(chatCalls()).toHaveLength(0)

    chat.seed({ conversation: { id: 'conv-1', generating: false, activeBranches: { __root__: 'u1' } }, messages: [message({ id: 'u1' })] })
    await flush()
    await flush()

    expect(chatCalls()[0].body).toMatchObject({ message: 'early', parentId: 'u1' })
  })
})

describe('new conversations', () => {
  it('shows the conversation in the sidebar instantly and asks the server to create it once', async () => {
    const { chat, conversations, chatCalls } = setup()
    const local = summary({ id: 'conv-1', systemPromptId: 'prompt-1' })
    conversations.reset([])
    chat.pendingCreation = local

    const sending = chat.sendMessage('first')
    expect(conversations.get('conv-1')).toEqual(local)
    await sending

    const { assistantMsgId, userMsgId } = chatCalls()[0].body
    chat.upsertMessage(assistant({ id: String(assistantMsgId), parentId: String(userMsgId), generating: false, eventSeq: 1 }))
    await chat.sendMessage('second')

    expect(chatCalls().map(c => c.body.createConversation)).toEqual([{ systemPromptId: 'prompt-1' }, undefined])
    expect(conversations.confirmed('conv-1')).toBeDefined()
  })

  it('applies the generated title after the first exchange only', async () => {
    const { chat, conversations, calls } = setup({ handler: path => (path === '/api/chat/title' ? { title: 'Greeting' } : {}) })

    await chat.sendMessage('hello')
    await flush()

    expect(calls.map(c => c.path)).toEqual(['/api/chat', '/api/chat/title'])
    expect(conversations.get('conv-1')?.title).toBe('Greeting')
  })

  it('does not request a title for follow-up messages', async () => {
    const { chat, calls } = setup({ messages: [message({ id: 'u1' }), message({ id: 'a1', role: 'assistant', parentId: 'u1' })], branches: { __root__: 'u1', u1: 'a1' } })

    await chat.sendMessage('second')

    expect(calls.map(c => c.path)).toEqual(['/api/chat'])
  })

  it('notifies when the title request fails', async () => {
    const errors: string[] = []
    const { chat } = setup({
      notify: m => errors.push(m),
      handler: path => {
        if (path === '/api/chat/title') {
          throw new Error('title boom')
        }
        return {}
      },
    })

    await chat.sendMessage('hello')
    await flush()

    expect(errors).toEqual(['title boom'])
  })
})

describe('branches and recovery', () => {
  it('keeps an optimistic branch switch on top of stale server state until acknowledged', async () => {
    const pending = deferred()
    const messages = [message({ id: 'a1', role: 'assistant', createdAt: new Date(1) }), message({ id: 'a2', role: 'assistant', createdAt: new Date(2) })]
    const { chat, conversationStates } = setup({ messages, branches: { __root__: 'a1' }, handler: () => pending.promise })

    const switching = chat.switchBranch('__root__', 'a2')
    conversationStates.receive({ id: 'conv-1', generating: false, activeBranches: { __root__: 'a1', other: 'x' } })
    expect(chat.activeBranches).toEqual({ __root__: 'a2', other: 'x' })

    pending.resolve({})
    await switching
    expect(conversationStates.confirmed('conv-1')?.activeBranches.__root__).toBe('a2')

    conversationStates.receive({ id: 'conv-1', generating: false, activeBranches: { __root__: 'a1' } })
    expect(chat.activeBranches.__root__).toBe('a1')
  })

  it('discards a failed message with its branch entry and ignores late upserts for it', async () => {
    const { chat } = setup({
      handler: () => {
        throw new Error('boom')
      },
    })

    await chat.sendMessage('hi')
    const failedId = chat.allMessages[0].id
    chat.discardFailedMessage(failedId)

    expect(chat.allMessages).toHaveLength(0)
    expect(Object.values(chat.activeBranches)).not.toContain(failedId)

    chat.upsertMessage(message({ id: failedId, content: 'hi' }))
    expect(chat.allMessages).toHaveLength(0)
  })

  it('retries a send that never reached the server with the same ids', async () => {
    let attempt = 0
    const { chat, chatCalls } = setup({
      handler: () => {
        if (++attempt === 1) {
          throw new Error('first failure')
        }
        return {}
      },
    })

    await chat.sendMessage('retry me', [{ id: 'img.png', mimeType: 'image/png' }], [{ id: 'f.csv', filename: 'f.csv', mimeType: 'text/csv' }])
    const failedId = chat.allMessages[0].id
    await chat.retryFailedMessage(failedId)

    expect(chatCalls()[1].body).toMatchObject({ userMsgId: failedId, skipUserInsert: false, message: 'retry me', images: [{ id: 'img.png', mimeType: 'image/png' }] })
    expect(chat.allMessages[0].sendError).toBeUndefined()
    expect(chat.isStreaming).toBe(true)
  })

  it('retries a persisted message that failed on the server without inserting it again', async () => {
    const { chat, chatCalls } = setup({ messages: [message({ id: 'user-1', content: 'hi', sendError: 'Overloaded' })], branches: { __root__: 'user-1' } })

    const retrying = chat.retryFailedMessage('user-1')
    expect(chat.allMessages[0].sendError).toBeUndefined()
    await retrying

    expect(chatCalls()[0].body).toMatchObject({ userMsgId: 'user-1', skipUserInsert: true })
    expect(chat.isStreaming).toBe(true)
  })

  it('edits with a single request that inserts the branched user message', async () => {
    const messages = [message({ id: 'user-1', content: 'original' }), message({ id: 'asst-1', role: 'assistant', parentId: 'user-1', content: 'answer', createdAt: new Date(2) })]
    const { chat, calls } = setup({ messages, branches: { __root__: 'user-1', 'user-1': 'asst-1' } })

    await chat.editMessage('user-1', 'edited')

    const edited = chat.allMessages.find(m => m.content === 'edited')
    expect(calls.map(c => c.path)).toEqual(['/api/chat'])
    expect(calls[0].body).toMatchObject({ userMsgId: edited?.id, parentId: null, skipUserInsert: false, message: 'edited' })
    expect(chat.activeBranches.__root__).toBe(edited?.id)
    expect(chat.messages.map(m => m.content)).toEqual(['edited', ''])
  })

  it('regenerates with an instant placeholder and rolls it back when the request fails', async () => {
    const errors: string[] = []
    const stop = onSyncError(m => errors.push(m))
    const messages = [message({ id: 'user-1', content: 'hi' }), message({ id: 'asst-1', role: 'assistant', parentId: 'user-1', content: 'answer', createdAt: new Date(2) })]
    const { chat } = setup({
      messages,
      branches: { __root__: 'user-1', 'user-1': 'asst-1' },
      handler: () => {
        throw new Error('regen failed')
      },
    })

    const regenerating = chat.regenerateMessage('asst-1')
    expect(chat.messages.at(-1)).toMatchObject({ role: 'assistant', generating: true, content: '' })
    await regenerating
    stop()

    expect(chat.isStreaming).toBe(false)
    expect(chat.messages.at(-1)?.id).toBe('asst-1')
    expect(errors).toEqual(['regen failed'])
  })

  it('stops instantly and reads the final snapshot once the server settled', async () => {
    const final = assistant({ content: 'hello world', generating: false, eventSeq: 2 })
    const { chat, calls } = setup({ messages: [assistant({ content: 'hello w', eventSeq: 1 })], generating: true, fetchMessage: async () => final })

    chat.stopStreaming()
    expect(chat.isStreaming).toBe(false)
    await flush()
    await flush()

    expect(calls.map(c => c.path)).toEqual(['/api/chat/stop'])
    expect(chat.allMessages[0].content).toBe('hello world')
  })

  it('keeps pending sends when the conversation is reseeded', async () => {
    const { chat } = setup({
      messages: [message({ id: 'm1', content: 'old' })],
      branches: { __root__: 'm1' },
      handler: () => {
        throw new Error('boom')
      },
    })

    await chat.sendMessage('unsent')
    chat.seed({ conversation: { id: 'conv-1', generating: false, activeBranches: { __root__: 'm1' } }, messages: [message({ id: 'm1', content: 'old' })] })

    expect(chat.allMessages.map(m => m.content)).toEqual(['old', 'unsent'])
  })
})

describe('stream events', () => {
  it('applies text ops on top of the snapshot', () => {
    const { chat } = setup({ messages: [assistant()] })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'he' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'llo' }] })

    expect(chat.streamingMessage?.content).toBe('hello')
  })

  it('buffers out-of-order events, fetches the gap once, and applies after fill', async () => {
    const fetches: { from: number; to: number | null }[] = []
    const { chat } = setup({
      messages: [assistant()],
      fetchStreamEvents: async (_messageId, from, to) => {
        fetches.push({ from, to })
        return [{ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'a' }] }]
      },
    })

    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'b' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 3, ops: [{ t: 'text', v: 'c' }] })
    expect(chat.allMessages[0].content).toBe('')
    await flush()

    expect(fetches).toEqual([{ from: 1, to: 1 }])
    expect(chat.allMessages[0].content).toBe('abc')
  })

  it('drops ops folded into a snapshot via eventSeq', () => {
    const { chat } = setup({ messages: [assistant()] })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'he' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'llo' }] })
    chat.upsertMessage(assistant({ content: 'hello', eventSeq: 2 }))
    expect(chat.allMessages[0].content).toBe('hello')

    chat.ingestEvent({ messageId: 'assist-1', seq: 3, ops: [{ t: 'text', v: '!' }] })
    expect(chat.allMessages[0].content).toBe('hello!')
  })

  it('ignores events already folded into the snapshot', () => {
    const { chat } = setup({ messages: [assistant({ content: 'hello', eventSeq: 2 })] })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'he' }] })
    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'llo' }] })

    expect(chat.allMessages[0].content).toBe('hello')
  })

  it('clears live state when the final snapshot arrives and ignores late events', () => {
    const { chat } = setup({ messages: [assistant()] })

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'hi' }] })
    chat.upsertMessage(assistant({ content: 'hi', generating: false, eventSeq: 1 }))
    chat.ingestEvent({ messageId: 'assist-1', seq: 2, ops: [{ t: 'text', v: 'stale' }] })

    expect(chat.isStreaming).toBe(false)
    expect(chat.allMessages[0].content).toBe('hi')
  })

  it('buffers events for an unknown message and applies them when the placeholder arrives', () => {
    const { chat } = setup()

    chat.ingestEvent({ messageId: 'assist-1', seq: 1, ops: [{ t: 'text', v: 'early' }] })
    expect(chat.allMessages).toHaveLength(0)

    chat.upsertMessage(assistant())
    expect(chat.allMessages[0].content).toBe('early')
  })

  it('streams into the optimistic placeholder before the server acknowledged it', async () => {
    const { chat, chatCalls } = setup({ handler: () => new Promise(() => {}) })

    void chat.sendMessage('hello')
    const assistantId = String(chatCalls()[0].body.assistantMsgId)
    chat.ingestEvent({ messageId: assistantId, seq: 1, ops: [{ t: 'text', v: 'fast' }] })

    expect(chat.streamingMessage?.content).toBe('fast')
  })

  it('ignores a snapshot older than the one it already holds', () => {
    const { chat } = setup({ messages: [assistant({ content: 'hello world', eventSeq: 5 })] })

    chat.upsertMessage(assistant({ content: 'hello', eventSeq: 3 }))

    expect(chat.allMessages[0].content).toBe('hello world')
  })

  it('catches up every generating assistant message from its snapshot', async () => {
    const fetches: { messageId: string; from: number }[] = []
    const { chat } = setup({
      messages: [assistant({ content: 'hi', eventSeq: 2 })],
      fetchStreamEvents: async (messageId, from) => {
        fetches.push({ messageId, from })
        return [{ messageId, seq: from, ops: [{ t: 'text', v: '!' }] }]
      },
    })

    await chat.catchUpStreams()

    expect(fetches).toEqual([{ messageId: 'assist-1', from: 3 }])
    expect(chat.allMessages[0].content).toBe('hi!')
  })

  it('persists the queue whenever it changes', async () => {
    const persisted: unknown[][] = []
    const { chat } = setup({ messages: [assistant()], persistQueue: queue => persisted.push(queue) })

    await chat.sendMessage('queued')
    await flush()

    expect(persisted.at(-1)).toEqual([expect.objectContaining({ content: 'queued' })])
  })
})

describe('silent realtime', () => {
  it('follows a generating message over HTTP when realtime delivers nothing', async () => {
    const snapshots = [assistant({ content: 'hel', eventSeq: 1 }), assistant({ content: 'hello', eventSeq: 2, generating: false })]
    const { chat } = setup({ messages: [assistant()], generating: true, realtimeLive: () => false, fetchMessage: async () => snapshots.shift() ?? null })

    await sleep(1_300)

    expect(chat.allMessages[0]).toMatchObject({ content: 'hello', generating: false })
  })

  it('removes a placeholder the server deleted and surfaces the error on the user message', async () => {
    const records: Record<string, ChatMessage | null> = { 'assist-1': null, 'user-1': message({ id: 'user-1', content: 'hi', sendError: 'No API key configured for anthropic' }) }
    const { chat, conversationStates } = setup({
      messages: [message({ id: 'user-1', content: 'hi' }), assistant({ parentId: 'user-1' })],
      branches: { __root__: 'user-1', 'user-1': 'assist-1' },
      generating: true,
      realtimeLive: () => false,
      fetchMessage: async id => records[id] ?? null,
    })

    await sleep(500)

    expect(chat.allMessages.map(m => m.id)).toEqual(['user-1'])
    expect(chat.allMessages[0].sendError).toBe('No API key configured for anthropic')
    expect(conversationStates.get('conv-1')?.generating).toBe(false)
    expect(chat.isStreaming).toBe(false)
  })
})
