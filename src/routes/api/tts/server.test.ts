import { getDecryptedKey } from '#lib/server/api-key.ts'
import { POST } from './+server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#lib/server/api-key.ts', () => ({ getDecryptedKey: vi.fn() }))

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

beforeEach(() => {
  vi.mocked(getDecryptedKey).mockReset().mockResolvedValue('configured')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('translation speech synthesis', () => {
  it('uses a Thai capable model and explicitly sets the target language', async () => {
    const upstream = setup()
    const response = await invoke({ text: 'สวัสดี', language: 'th' })
    expect(requestBody(upstream)).toEqual({ text: 'สวัสดี', model_id: 'eleven_v4', language_code: 'th' })
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/configured/stream?'), expect.anything())
  })

  it('uses the Portugal voice while keeping the upstream language code ISO 639-1', async () => {
    const upstream = setup()
    await invoke({ text: 'Olá', language: 'pt-PT' })
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/ID3DiXGPB7uwug5tZ3FB/stream?'), expect.anything())
    expect(requestBody(upstream)).toEqual({ text: 'Olá', model_id: 'eleven_v4', language_code: 'pt' })
  })

  it.each([
    ['en', 'Hello'],
    ['de', 'Hallo'],
    ['ja', 'こんにちは'],
    ['nl', 'Hallo'],
    ['es', 'Hola'],
  ])('uses v4 for %s without changing the selected voice', async (language, text) => {
    const upstream = setup()
    await invoke({ text, language })
    expect(requestBody(upstream)).toEqual({ text, model_id: 'eleven_v4', language_code: language })
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/configured/stream?'), expect.anything())
  })

  it('does not require a default voice for Portuguese from Portugal', async () => {
    vi.mocked(getDecryptedKey).mockImplementation(async (_userId, provider) => (provider === 'elevenlabs' ? 'configured' : null))
    const upstream = setup()
    const response = await invoke({ text: 'Olá', language: 'pt-PT' })
    expect(response.status).toBe(200)
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/ID3DiXGPB7uwug5tZ3FB/stream?'), expect.anything())
  })

  it('still requires an API key for the Portugal voice', async () => {
    vi.mocked(getDecryptedKey).mockResolvedValue(null)
    const upstream = setup()
    await expect(invoke({ text: 'Olá', language: 'pt-PT' })).rejects.toMatchObject({ status: 400, body: { message: expect.stringContaining('No ElevenLabs API key configured') } })
    expect(upstream).not.toHaveBeenCalled()
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
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/configured/stream?'), expect.anything())
  })

  it.each([null, { text: 42 }, { text: 'Hello', language: 'invalid' }, { text: 'a'.repeat(10001), language: 'en' }])('rejects invalid synthesis input %j', async body => {
    const upstream = setup()
    await expect(invoke(body)).rejects.toMatchObject({ status: 400 })
    expect(upstream).not.toHaveBeenCalled()
  })
})
