import { createChatStore } from './chat.svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const flush = () => new Promise(r => setTimeout(r, 0))

const installFetch = (impl: (url: unknown, init?: RequestInit) => Promise<Response>) => {
  const mock = vi.fn(impl)
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

const sseResponse = (body: string, init?: ResponseInit) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init })

const openSseResponse = (body: string, signal?: AbortSignal) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        signal?.addEventListener('abort', () => controller.close(), { once: true })
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )

describe('createChatStore.sendMessage failure handling', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('keeps the user message and marks it with sendError when POST /api/chat returns non-ok', async () => {
    installFetch(async () => new Response(JSON.stringify({ message: 'Simulated network failure' }), { status: 500 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello with image', undefined, [{ id: 'img-1.png', mimeType: 'image/png' }])
    await flush()

    expect(chat.allMessages.length).toBe(1)
    const userMsg = chat.allMessages[0]
    expect(userMsg.role).toBe('user')
    expect(userMsg.content).toBe('hello with image')
    expect(userMsg.images).toEqual([{ id: 'img-1.png', mimeType: 'image/png' }])
    expect(userMsg.sendError).toBe('Simulated network failure')
    expect(chat.isStreaming).toBe(false)
  })

  it('preserves sendError when a realtime upsert replaces the failed user message with the server version', async () => {
    installFetch(async () => new Response(JSON.stringify({ message: 'Overloaded' }), { status: 500 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hi')
    await flush()

    const failed = chat.allMessages[0]
    expect(failed.sendError).toBe('Overloaded')

    chat.upsertMessage({ ...failed, sendError: undefined })

    expect(chat.allMessages[0].sendError).toBe('Overloaded')
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

  it('discardFailedMessage removes the failed user message and clears its branch entry', async () => {
    installFetch(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hi')
    await flush()

    expect(chat.allMessages.length).toBe(1)
    const failedId = chat.allMessages[0].id
    expect(Object.values(chat.activeBranches)).toContain(failedId)

    chat.discardFailedMessage(failedId)

    expect(chat.allMessages.length).toBe(0)
    expect(Object.values(chat.activeBranches)).not.toContain(failedId)
  })

  it('attaches the streamed partial with the server assistant id when reconnect returns 404 (server finished while we were disconnected)', async () => {
    let calls = 0
    installFetch(async url => {
      ++calls
      if (calls === 1) {
        return sseResponse('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-assist-1"}\n\nid: 1\ndata: {"type":"text_delta","text":"partial "}\n\n')
      }
      expect(String(url)).toContain('/api/chat/stream/')
      return new Response('No active stream', { status: 404 })
    })

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    await flush()

    expect(calls).toBe(2)
    expect(chat.isStreaming).toBe(false)
    expect(chat.streamingText).toBe('')
    expect(chat.allMessages.length).toBe(2)
    const [userMsg, assistantMsg] = chat.allMessages
    expect(userMsg.role).toBe('user')
    expect(assistantMsg.role).toBe('assistant')
    expect(assistantMsg.id).toBe('srv-assist-1')
    expect(assistantMsg.content).toBe('partial ')
    expect(assistantMsg.parentId).toBe(userMsg.id)
    expect(chat.activeBranches[userMsg.id]).toBe('srv-assist-1')
  })

  it('attaches the streamed partial with the server assistant id when the stream emits an error event mid-generation', async () => {
    installFetch(async () => sseResponse('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-assist-2"}\n\nid: 1\ndata: {"type":"text_delta","text":"partial answer"}\n\nid: 2\ndata: {"type":"error","error":"Connection error"}\n\n'))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    await flush()

    expect(chat.isStreaming).toBe(false)
    expect(chat.allMessages.length).toBe(2)
    const [userMsg, assistantMsg] = chat.allMessages
    expect(userMsg.sendError).toBeUndefined()
    expect(assistantMsg.id).toBe('srv-assist-2')
    expect(assistantMsg.content).toBe('partial answer')
    expect(assistantMsg.parentId).toBe(userMsg.id)
    expect(chat.activeBranches[userMsg.id]).toBe('srv-assist-2')
  })

  it('marks the user message with sendError when the stream errors before producing any content', async () => {
    installFetch(async () => sseResponse('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-assist-3"}\n\nid: 1\ndata: {"type":"error","error":"Overloaded"}\n\n'))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    await flush()

    expect(chat.allMessages.length).toBe(1)
    expect(chat.allMessages[0].sendError).toBe('Overloaded')
    expect(chat.isStreaming).toBe(false)
  })

  it('does not create a phantom assistant message when the server completes with empty content (nothing persisted)', async () => {
    installFetch(async () => sseResponse('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-empty-1"}\n\nid: 1\ndata: {"type":"usage","inputTokens":10,"outputTokens":0}\n\nid: 2\ndata: {"type":"done"}\n\nid: 3\ndata: {"type":"stream_end"}\n\n'))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'weiter')
    await flush()

    expect(chat.isStreaming).toBe(false)
    expect(chat.allMessages.length).toBe(1)
    expect(chat.allMessages[0].role).toBe('user')
    expect(Object.keys(chat.activeBranches)).not.toContain(chat.allMessages[0].id)
  })

  it('creates the assistant message with the server id when the stream completes with content', async () => {
    installFetch(async () => sseResponse('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-ok-1"}\n\nid: 1\ndata: {"type":"text_delta","text":"full answer"}\n\nid: 2\ndata: {"type":"done","messageId":"srv-ok-1"}\n\nid: 3\ndata: {"type":"stream_end"}\n\n'))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'hello')
    await flush()

    expect(chat.allMessages.length).toBe(2)
    const [userMsg, assistantMsg] = chat.allMessages
    expect(assistantMsg.id).toBe('srv-ok-1')
    expect(assistantMsg.content).toBe('full answer')
    expect(assistantMsg.parentId).toBe(userMsg.id)
    expect(chat.activeBranches[userMsg.id]).toBe('srv-ok-1')
  })

  it('resumeStream attaches to an in-flight stream and replaces the placeholder with the completed message', async () => {
    let requestedUrl: unknown
    installFetch(async url => {
      requestedUrl = url
      return sseResponse(
        'id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-resume-1","parentId":"user-1"}\n\nid: 1\ndata: {"type":"text_delta","text":"was "}\n\nid: 2\ndata: {"type":"text_delta","text":"streaming"}\n\nid: 3\ndata: {"type":"done","messageId":"srv-resume-1"}\n\nid: 4\ndata: {"type":"stream_end"}\n\n',
      )
    })

    const chat = createChatStore({
      allMessages: [
        { id: 'user-1', conversationId: 'conv-1', parentId: null, role: 'user', content: 'hello', createdAt: new Date() },
        { id: 'srv-resume-1', conversationId: 'conv-1', parentId: 'user-1', role: 'assistant', content: '', generating: true, createdAt: new Date() },
      ],
      activeBranches: { __root__: 'user-1' },
    })
    chat.selectedModel = 'anthropic/claude-test'

    const resumed = await chat.resumeStream('conv-1')
    await flush()

    expect(resumed).toBe(true)
    expect(String(requestedUrl)).toContain('/api/chat/stream/conv-1?cursor=0')
    expect(chat.isStreaming).toBe(false)
    expect(chat.allMessages.length).toBe(2)
    const assistantMsg = chat.allMessages[1]
    expect(assistantMsg.id).toBe('srv-resume-1')
    expect(assistantMsg.content).toBe('was streaming')
    expect(assistantMsg.parentId).toBe('user-1')
    expect(chat.activeBranches['user-1']).toBe('srv-resume-1')
  })

  it('resumeStream keeps accumulating text after a mid-stream reconnect', async () => {
    let calls = 0
    installFetch(async () => {
      ++calls
      if (calls === 1) {
        return sseResponse('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-resume-2","parentId":"user-2"}\n\nid: 1\ndata: {"type":"text_delta","text":"first "}\n\n')
      }
      return sseResponse('id: 2\ndata: {"type":"text_delta","text":"second"}\n\nid: 3\ndata: {"type":"done","messageId":"srv-resume-2"}\n\nid: 4\ndata: {"type":"stream_end"}\n\n')
    })

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    const resumed = await chat.resumeStream('conv-1')
    await flush()

    expect(resumed).toBe(true)
    expect(calls).toBe(2)
    expect(chat.allMessages.length).toBe(1)
    expect(chat.allMessages[0].content).toBe('first second')
  })

  it('resumeStream returns false and stops streaming when there is no active stream (404)', async () => {
    installFetch(async () => new Response('No active stream', { status: 404 }))

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    const resumed = await chat.resumeStream('conv-1')
    await flush()

    expect(resumed).toBe(false)
    expect(chat.isStreaming).toBe(false)
    expect(chat.allMessages.length).toBe(0)
  })

  it('resumeStream is a no-op while already streaming that conversation', async () => {
    installFetch(async (url, init) => {
      if (String(url).includes('/api/chat/stream/')) {
        return openSseResponse('', init?.signal ?? undefined)
      }
      return sseResponse('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-guard-1"}\n\nid: 1\ndata: {"type":"text_delta","text":"hi"}\n\n')
    })

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    const sending = chat.sendMessage('conv-1', 'hello')
    await flush()
    const resumed = await chat.resumeStream('conv-1')

    expect(resumed).toBe(true)
    expect(chat.isStreaming).toBe(true)
    chat.detachStream()
    await sending
  })

  it('reconnects with cursor when the stream goes silent mid-generation (stall watchdog)', async () => {
    vi.useFakeTimers()
    const chat = createChatStore()
    try {
      let calls = 0
      installFetch(async url => {
        ++calls
        if (calls === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('id: 0\ndata: {"type":"stream_meta","assistantMsgId":"srv-stall-1"}\n\nid: 1\ndata: {"type":"text_delta","text":"first "}\n\n'))
              },
            }),
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          )
        }
        expect(String(url)).toContain('/api/chat/stream/conv-1?cursor=2')
        return sseResponse('id: 2\ndata: {"type":"text_delta","text":"second"}\n\nid: 3\ndata: {"type":"done","messageId":"srv-stall-1"}\n\nid: 4\ndata: {"type":"stream_end"}\n\n')
      })

      chat.selectedModel = 'anthropic/claude-test'

      const sending = chat.sendMessage('conv-1', 'hello')
      await vi.advanceTimersByTimeAsync(0)
      expect(chat.streamingText).toBe('first ')

      await vi.advanceTimersByTimeAsync(30_000)
      expect(calls).toBe(2)
      await sending

      expect(chat.isStreaming).toBe(false)
      expect(chat.allMessages.length).toBe(2)
      expect(chat.allMessages[1].content).toBe('first second')
    } finally {
      chat.stopStreaming()
      vi.useRealTimers()
    }
  })

  it('retryFailedMessage reuses the failed message and re-triggers generation via skipUserInsert', async () => {
    let calls = 0
    const sentBodies: unknown[] = []
    installFetch(async (_url, init) => {
      sentBodies.push(init?.body ? JSON.parse(init.body as string) : null)
      ++calls
      if (calls === 1) return new Response(JSON.stringify({ message: 'first failure' }), { status: 500 })
      return new Response(JSON.stringify({ message: 'second failure' }), { status: 500 })
    })

    const chat = createChatStore()
    chat.selectedModel = 'anthropic/claude-test'

    await chat.sendMessage('conv-1', 'retry me', undefined, [{ id: 'img.png', mimeType: 'image/png' }], [{ id: 'f.csv', filename: 'f.csv', mimeType: 'text/csv' }])
    await flush()

    const failedId = chat.allMessages[0].id
    expect(chat.allMessages[0].sendError).toBe('first failure')

    await chat.retryFailedMessage('conv-1', failedId)
    await flush()

    expect(chat.allMessages.length).toBe(1)
    expect(chat.allMessages[0].id).toBe(failedId)
    expect(chat.allMessages[0].content).toBe('retry me')
    expect(chat.allMessages[0].images).toEqual([{ id: 'img.png', mimeType: 'image/png' }])
    expect(chat.allMessages[0].files).toEqual([{ id: 'f.csv', filename: 'f.csv', mimeType: 'text/csv' }])
    expect(chat.allMessages[0].sendError).toBe('second failure')
    expect(calls).toBe(2)

    const firstBody = sentBodies[0] as { images: unknown; files: unknown }
    expect(firstBody.images).toEqual([{ id: 'img.png', mimeType: 'image/png' }])
    expect(firstBody.files).toEqual([{ id: 'f.csv', filename: 'f.csv', mimeType: 'text/csv' }])

    const retryBody = sentBodies[1] as { userMsgId: string; parentId: string | null; skipUserInsert: boolean }
    expect(retryBody.userMsgId).toBe(failedId)
    expect(retryBody.parentId).toBeNull()
    expect(retryBody.skipUserInsert).toBe(true)
  })
})
