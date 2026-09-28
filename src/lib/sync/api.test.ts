import { api } from './api'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch

const stubFetch = (impl: () => Promise<Response>) => {
  globalThis.fetch = Object.assign(vi.fn(impl), { preconnect: originalFetch.preconnect })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('api', () => {
  it('surfaces the server error message', async () => {
    stubFetch(async () => new Response(JSON.stringify({ message: 'Simulated network failure' }), { status: 500 }))

    await expect(api.post('/api/chat', {})).rejects.toThrow('Simulated network failure')
  })

  it('falls back to a generic message when the body is not JSON', async () => {
    stubFetch(async () => new Response('not-json', { status: 502 }))

    await expect(api.patch('/api/conversations/a', {})).rejects.toThrow('Request failed')
  })

  it('propagates network failures', async () => {
    stubFetch(async () => {
      throw new TypeError('Load failed')
    })

    await expect(api.delete('/api/conversations/a')).rejects.toThrow('Load failed')
  })

  it('parses JSON bodies and tolerates empty ones', async () => {
    stubFetch(async () => new Response(JSON.stringify({ title: 'Hi' }), { status: 200 }))
    await expect(api.post('/api/chat/title', {})).resolves.toEqual({ title: 'Hi' })

    stubFetch(async () => new Response(null, { status: 204 }))
    await expect(api.post('/api/chat/stop', {})).resolves.toBeUndefined()
  })
})
