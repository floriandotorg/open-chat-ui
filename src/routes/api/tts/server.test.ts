import { POST } from './+server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('#lib/server/api-key.ts', () => ({ getDecryptedKey: async () => 'configured' }))

const invoke = (body: unknown): Promise<Response> =>
  Reflect.apply(POST, undefined, [
    {
      request: new Request('http://localhost/api/tts', { method: 'POST', body: JSON.stringify(body) }),
      locals: { user: { id: 'user', email: 'test@example.com', name: 'Test' } },
    },
  ])

const setup = () => {
  const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response('audio'))
  vi.stubGlobal('fetch', upstream)
  return upstream
}

const requestBody = (upstream: ReturnType<typeof setup>): unknown => {
  const body = upstream.mock.calls[0]?.[1]?.body
  if (typeof body !== 'string') {
    throw new Error('Missing upstream request body')
  }
  return JSON.parse(body)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('translation speech synthesis', () => {
  it('uses a Thai capable model and explicitly sets the target language', async () => {
    const upstream = setup()
    const response = await invoke({ text: 'สวัสดี', language: 'th' })
    expect(requestBody(upstream)).toEqual({ text: 'สวัสดี', model_id: 'eleven_v4', language_code: 'th' })
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
  })

  it('normalizes regional language codes', async () => {
    const upstream = setup()
    await invoke({ text: 'Olá', language: 'pt-PT' })
    expect(requestBody(upstream)).toMatchObject({ language_code: 'pt' })
  })

  it('reads long translations without silently truncating them', async () => {
    const upstream = setup()
    const text = 'ก'.repeat(6000)
    await invoke({ text, language: 'th' })
    expect(requestBody(upstream)).toMatchObject({ text })
  })

  it('preserves the existing chat model when no language is provided', async () => {
    const upstream = setup()
    await invoke({ text: 'Hello' })
    expect(requestBody(upstream)).toEqual({ text: 'Hello', model_id: 'eleven_multilingual_v2' })
  })

  it.each([null, { text: 42 }, { text: 'Hello', language: 'invalid' }, { text: 'a'.repeat(10001), language: 'en' }])('rejects invalid synthesis input %j', async body => {
    const upstream = setup()
    await expect(invoke(body)).rejects.toMatchObject({ status: 400 })
    expect(upstream).not.toHaveBeenCalled()
  })
})
