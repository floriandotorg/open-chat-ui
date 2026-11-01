import { getDecryptedKey } from '#lib/server/api-key.ts'
import { speechCache } from '#lib/server/speech-cache.ts'
import { POST } from './+server'
import { GET } from './[id]/+server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#lib/server/api-key.ts', () => ({ getDecryptedKey: vi.fn() }))

const invoke = (body: unknown): Promise<Response> =>
  Reflect.apply(POST, undefined, [
    {
      request: new Request('http://localhost/api/tts', { method: 'POST', body: JSON.stringify(body) }),
      locals: { user: { id: 'user', email: 'test@example.com', name: 'Test' } },
    },
  ])

const playbackUrl = async (response: Response) => {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('url' in body) || typeof body.url !== 'string') {
    throw new Error('Missing playback URL')
  }
  return body.url
}

const playback = async (url: string, userId: string | undefined = 'user', range?: string, method = 'GET'): Promise<Response> =>
  Reflect.apply(GET, undefined, [{ request: new Request(`http://localhost${url}`, { method, headers: range ? { Range: range } : {} }), params: { id: url.split('/').at(-1) }, locals: { user: userId ? { id: userId } : undefined } }])

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
  speechCache.clear()
  vi.unstubAllGlobals()
})

describe('translation speech synthesis', () => {
  it('keeps a Thai capable model because Flash does not support Thai', async () => {
    const upstream = setup()
    const response = await invoke({ text: 'สวัสดี', language: 'th' })
    expect(requestBody(upstream)).toEqual({ text: 'สวัสดี', model_id: 'eleven_v4', language_code: 'th' })
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const url = await playbackUrl(response)
    expect(url).toMatch(/^\/api\/tts\/[\da-f-]+$/)
    expect(await (await playback(url)).text()).toBe('audio')
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/configured/stream?'), expect.anything())
  })

  it('uses the Portugal voice while keeping the upstream language code ISO 639-1', async () => {
    const upstream = setup()
    await invoke({ text: 'Olá', language: 'pt-PT' })
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/ID3DiXGPB7uwug5tZ3FB/stream?'), expect.anything())
    expect(requestBody(upstream)).toEqual({ text: 'Olá', model_id: 'eleven_flash_v2_5', language_code: 'pt' })
  })

  it.each([
    ['en', 'Hello'],
    ['de', 'Hallo'],
    ['ja', 'こんにちは'],
    ['nl', 'Hallo'],
    ['es', 'Hola'],
  ])('uses low-latency Flash for %s without changing the selected voice', async (language, text) => {
    const upstream = setup()
    await invoke({ text, language })
    expect(requestBody(upstream)).toEqual({ text, model_id: 'eleven_flash_v2_5', language_code: language })
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/configured/stream?'), expect.anything())
  })

  it('does not require a default voice for Portuguese from Portugal', async () => {
    vi.mocked(getDecryptedKey).mockImplementation(async (_userId, provider) => (provider === 'elevenlabs' ? 'configured' : null))
    const upstream = setup()
    const response = await invoke({ text: 'Olá', language: 'pt-PT' })
    expect(response.status).toBe(201)
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

  it('uses lower-bandwidth MP3 without leaking text or credentials into playback URLs', async () => {
    const upstream = setup()
    const url = await playbackUrl(await invoke({ text: 'Private translation', language: 'en' }))
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('output_format=mp3_44100_64'), expect.anything())
    expect(url).not.toContain('Private')
    expect(url).not.toContain('configured')
  })

  it('reuses cached speech for replay and range requests without regenerating it', async () => {
    const upstream = setup()
    const url = await playbackUrl(await invoke({ text: 'Hello' }))
    expect(await (await playback(url)).text()).toBe('audio')
    const response = await playback(url, 'user', 'bytes=1-3')
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('udi')
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('guards playback with authentication and user ownership', async () => {
    setup()
    const url = await playbackUrl(await invoke({ text: 'Private' }))
    await expect(playback(url, '')).rejects.toMatchObject({ status: 401 })
    await expect(playback(url, 'other-user')).rejects.toMatchObject({ status: 404 })
  })

  it('supports native media HEAD requests', async () => {
    setup()
    const url = await playbackUrl(await invoke({ text: 'Hello' }))
    const response = await playback(url, 'user', undefined, 'HEAD')
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
  })

  it('does not publish a playback URL when synthesis fails', async () => {
    const upstream = setup()
    upstream.mockResolvedValue(new Response('Unavailable', { status: 503 }))
    await expect(invoke({ text: 'Hello' })).rejects.toMatchObject({ status: 503 })
  })

  it.each([null, { text: 42 }, { text: 'Hello', language: 'invalid' }, { text: 'a'.repeat(10001), language: 'en' }])('rejects invalid synthesis input %j', async body => {
    const upstream = setup()
    await expect(invoke(body)).rejects.toMatchObject({ status: 400 })
    expect(upstream).not.toHaveBeenCalled()
  })
})
