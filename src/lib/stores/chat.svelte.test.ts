import { createChatStore } from './chat.svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const flush = () => new Promise(r => setTimeout(r, 0))

const installFetch = (impl: (url: unknown, init?: RequestInit) => Promise<Response>) => {
  const mock = vi.fn(impl)
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

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

  it('retryFailedMessage discards the failed message and resends with the same content/images/files', async () => {
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
    expect(chat.allMessages[0].id).not.toBe(failedId)
    expect(chat.allMessages[0].content).toBe('retry me')
    expect(chat.allMessages[0].images).toEqual([{ id: 'img.png', mimeType: 'image/png' }])
    expect(chat.allMessages[0].files).toEqual([{ id: 'f.csv', filename: 'f.csv', mimeType: 'text/csv' }])
    expect(chat.allMessages[0].sendError).toBe('second failure')
    expect(calls).toBe(2)

    const firstBody = sentBodies[0] as { images: unknown; files: unknown }
    expect(firstBody.images).toEqual([{ id: 'img.png', mimeType: 'image/png' }])
    expect(firstBody.files).toEqual([{ id: 'f.csv', filename: 'f.csv', mimeType: 'text/csv' }])
  })
})
