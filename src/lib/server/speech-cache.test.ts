import { createSpeechCache } from './speech-cache'
import { afterEach, describe, expect, it, vi } from 'vitest'

const caches: ReturnType<typeof createSpeechCache>[] = []
const encoder = new TextEncoder()
const setup = (options: Parameters<typeof createSpeechCache>[0] = {}) => {
  const cache = createSpeechCache({ initialBufferBytes: 4, ...options })
  caches.push(cache)
  let source: ReadableStreamDefaultController<Uint8Array> | undefined
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller
    },
    cancel,
  })
  if (!source) {
    throw new Error('Missing source controller')
  }
  const controller = source
  const id = cache.create('user', stream)
  const send = (text: string) => controller.enqueue(encoder.encode(text))
  const finish = () => controller.close()
  return { cache, id, send, finish, cancel, source: controller }
}
const request = (range?: string, method = 'GET') => new Request('http://localhost/api/tts/speech', { method, headers: range ? { Range: range } : {} })
const completed = async () => {
  const state = setup()
  state.send('0123456789')
  state.finish()
  await vi.waitFor(() => {
    expect(state.cache.respond('user', state.id, request('bytes=0-1')).status).toBe(206)
  })
  return state
}

afterEach(() => {
  for (const cache of caches.splice(0)) {
    cache.clear()
  }
  vi.useRealTimers()
})

describe('native speech streaming cache', () => {
  it('streams before generation finishes after building a small initial buffer', async () => {
    const { cache, id, send, finish } = setup()
    const response = cache.respond('user', id, request())
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Missing audio stream')
    }
    const first = reader.read()
    const received = vi.fn()
    void first.then(received)
    send('01')
    await Promise.resolve()
    expect(received).not.toHaveBeenCalled()
    send('23')
    expect((await first).value).toEqual(encoder.encode('01'))
    expect((await reader.read()).value).toEqual(encoder.encode('23'))
    send('45')
    expect((await reader.read()).value).toEqual(encoder.encode('45'))
    finish()
    expect((await reader.read()).done).toBe(true)
  })

  it('plays short completed clips without waiting for the buffer target', async () => {
    const { cache, id, send, finish } = setup()
    send('Hi')
    finish()
    expect(await cache.respond('user', id, request()).text()).toBe('Hi')
  })

  it('retains generation when a listener disconnects and replays the same bytes', async () => {
    const { cache, id, send, finish, cancel } = setup()
    const first = cache.respond('user', id, request()).body?.getReader()
    send('0123')
    await first?.read()
    await first?.cancel()
    expect(cancel).not.toHaveBeenCalled()
    send('4567')
    finish()
    expect(await cache.respond('user', id, request()).text()).toBe('01234567')
    expect(await cache.respond('user', id, request()).text()).toBe('01234567')
  })

  it('isolates playback URLs by user and hides unknown IDs', () => {
    const { cache, id } = setup()
    expect(() => cache.respond('another-user', id, request())).toThrowError(expect.objectContaining({ status: 404 }))
    expect(() => cache.respond('user', 'unknown', request())).toThrowError(expect.objectContaining({ status: 404 }))
  })

  it.each([
    ['bytes=0-1', '01', 'bytes 0-1/10'],
    ['bytes=5-', '56789', 'bytes 5-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-100', '89', 'bytes 8-9/10'],
    ['bytes=-100', '0123456789', 'bytes 0-9/10'],
  ])('serves cached byte range %s', async (range, expected, contentRange) => {
    const { cache, id } = await completed()
    const response = cache.respond('user', id, request(range))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(contentRange)
    expect(response.headers.get('Content-Length')).toBe(String(expected.length))
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(await response.text()).toBe(expected)
  })

  it.each(['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=999999999999999999999-'])('rejects unsatisfiable range %s', async range => {
    const { cache, id } = await completed()
    const response = cache.respond('user', id, request(range))
    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */10')
  })

  it.each(['bytes=0-1,4-5', 'invalid', 'items=0-1'])('ignores unsupported range %s', async range => {
    const { cache, id } = await completed()
    const response = cache.respond('user', id, request(range))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('0123456789')
  })

  it('ignores ranges until the complete length is known', async () => {
    const { cache, id, send, finish } = setup()
    send('0123')
    const response = cache.respond('user', id, request('bytes=0-1'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Accept-Ranges')).toBe('none')
    finish()
    expect(await response.text()).toBe('0123')
  })

  it('honors If-Range only for the same cached audio', async () => {
    const { cache, id } = await completed()
    const original = cache.respond('user', id, request())
    const matching = request('bytes=0-1')
    matching.headers.set('If-Range', original.headers.get('ETag') ?? '')
    expect(cache.respond('user', id, matching).status).toBe(206)
    matching.headers.set('If-Range', '"different"')
    expect(cache.respond('user', id, matching).status).toBe(200)
  })

  it('answers HEAD without streaming or consuming cached audio', async () => {
    const { cache, id } = await completed()
    const response = cache.respond('user', id, request(undefined, 'HEAD'))
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(response.body).toBeNull()
    expect(await cache.respond('user', id, request()).text()).toBe('0123456789')
  })

  it('expires audio and cancels unfinished generation even without further requests', async () => {
    vi.useFakeTimers()
    const { cache, id, cancel } = setup({ ttlMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    expect(() => cache.respond('user', id, request())).toThrowError(expect.objectContaining({ status: 404 }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('bounds entry count and cancels evicted generation', async () => {
    const { cache, id, cancel } = setup({ maxEntries: 1 })
    cache.create('other', new ReadableStream())
    expect(() => cache.respond('user', id, request())).toThrowError(expect.objectContaining({ status: 404 }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('bounds the number of entries held by one user', () => {
    const { cache, id } = setup({ maxEntriesPerUser: 1 })
    cache.create('other', new ReadableStream())
    cache.create('user', new ReadableStream())
    expect(() => cache.respond('user', id, request())).toThrowError(expect.objectContaining({ status: 404 }))
  })

  it('bounds total audio memory by evicting older entries', async () => {
    const { cache, id, send } = setup({ maxBytes: 8 })
    send('012345')
    await Promise.resolve()
    const next = cache.create(
      'other',
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('abcdef'))
          controller.close()
        },
      }),
    )
    await vi.waitFor(() => {
      expect(() => cache.respond('user', id, request())).toThrowError(expect.objectContaining({ status: 404 }))
    })
    expect(await cache.respond('other', next, request()).text()).toBe('abcdef')
  })

  it('fails oversized audio and releases the upstream source', async () => {
    const { cache, id, send, cancel } = setup({ maxEntryBytes: 4 })
    send('012345')
    await vi.waitFor(() => {
      expect(() => cache.respond('user', id, request())).toThrowError(expect.objectContaining({ status: 502 }))
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('propagates upstream failures to listeners rather than completing truncated audio', async () => {
    const { cache, id, source } = setup()
    const response = cache.respond('user', id, request())
    source.error(new Error('Upstream disconnected'))
    await expect(response.text()).rejects.toThrow('Speech generation failed')
    expect(() => cache.respond('user', id, request())).toThrowError(expect.objectContaining({ status: 502 }))
  })

  it('rejects empty generated audio', async () => {
    const { cache, id, finish } = setup()
    finish()
    await vi.waitFor(() => {
      expect(() => cache.respond('user', id, request())).toThrowError(expect.objectContaining({ status: 502 }))
    })
  })
})
