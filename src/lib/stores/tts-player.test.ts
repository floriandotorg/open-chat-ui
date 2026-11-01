import { createTtsPlayer } from './tts-player.svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(complete => {
    resolve = complete
  })
  return { promise, resolve }
}

const setup = () => {
  const audio = { playbackRate: 1, src: '', addEventListener: vi.fn(), play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() }
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        Object.assign(this, audio)
      }
    },
  )
  vi.stubGlobal('MediaSource', undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:speech')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const fetchAudio = vi.fn<typeof fetch>().mockImplementation(async () => new Response('audio'))
  vi.stubGlobal('fetch', fetchAudio)
  return { audio, fetchAudio, player: createTtsPlayer() }
}

const enableStreaming = () => {
  const sourceBuffer = new EventTarget()
  const appendBuffer = vi.fn(() => {
    queueMicrotask(() => sourceBuffer.dispatchEvent(new Event('updateend')))
  })
  Object.assign(sourceBuffer, { appendBuffer })
  const endOfStream = vi.fn()
  vi.stubGlobal(
    'MediaSource',
    class extends EventTarget {
      static isTypeSupported = () => true
      readyState = 'open'
      addSourceBuffer = () => sourceBuffer
      endOfStream = endOfStream
      constructor() {
        super()
        queueMicrotask(() => this.dispatchEvent(new Event('sourceopen')))
      }
    },
  )
  return { appendBuffer, endOfStream }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('translated text playback', () => {
  it('sends the target language with the translated text', async () => {
    const { player, fetchAudio } = setup()
    await player.play('สวัสดี', 'th')
    expect(fetchAudio).toHaveBeenCalledWith('/api/tts', expect.objectContaining({ body: JSON.stringify({ text: 'สวัสดี', language: 'th' }) }))
    expect(player.playing).toBe(true)
  })

  it('ignores responses that arrive after the player closes', async () => {
    const { player, audio, fetchAudio } = setup()
    const pending = deferred<Response>()
    fetchAudio.mockReturnValue(pending.promise)
    const playback = player.play('Hello')
    player.close()
    pending.resolve(new Response('audio'))
    await playback
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(player.visible).toBe(false)
    expect(player.playing).toBe(false)
  })

  it('does not play an audio blob that finishes loading after close', async () => {
    const { player, audio, fetchAudio } = setup()
    const pending = deferred<Blob>()
    const response = new Response('audio')
    const readBlob = vi.spyOn(response, 'blob').mockReturnValue(pending.promise)
    fetchAudio.mockResolvedValue(response)
    const playback = player.play('Hello')
    await vi.waitFor(() => {
      expect(readBlob).toHaveBeenCalled()
    })
    player.close()
    pending.resolve(new Blob(['audio']))
    await playback
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(player.playing).toBe(false)
  })

  it('keeps newer playback when an older request fails', async () => {
    const { player, fetchAudio } = setup()
    const pending = deferred<Response>()
    fetchAudio.mockReturnValueOnce(pending.promise)
    const previous = player.play('Old')
    await player.play('New')
    pending.resolve(Response.json({ message: 'Old request failed' }, { status: 400 }))
    await previous
    expect(player.errorMessage).toBe('')
    expect(player.playing).toBe(true)
  })

  it('unlocks audio before requesting speech', async () => {
    const { player, audio, fetchAudio } = setup()
    const pending = deferred<Response>()
    fetchAudio.mockReturnValue(pending.promise)
    const playback = player.play('Hello')
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.play.mock.invocationCallOrder[0]).toBeLessThan(fetchAudio.mock.invocationCallOrder[0])
    pending.resolve(new Response('audio'))
    await playback
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('reuses the element unlocked by the translate button', async () => {
    const { player, audio } = setup()
    player.prepare()
    const unlockedElement: unknown = audio.play.mock.contexts[0]
    expect(player.playing).toBe(false)
    await player.play('สวัสดี', 'th')
    expect(audio.play.mock.contexts[1]).toBe(unlockedElement)
    expect(player.playing).toBe(true)
  })

  it('allows retrying blocked audio without requesting speech again', async () => {
    const { player, audio, fetchAudio } = setup()
    audio.play.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    await player.play('Hello')
    expect(player.loading).toBe(false)
    expect(player.playing).toBe(false)
    expect(player.blocked).toBe(true)
    expect(player.errorMessage).toContain('blocked')
    player.togglePlay()
    await vi.waitFor(() => {
      expect(player.playing).toBe(true)
    })
    expect(player.blocked).toBe(false)
    expect(player.errorMessage).toBe('')
    expect(fetchAudio).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(3)
  })

  it('plays streamed audio on the unlocked element', async () => {
    const { player, audio } = setup()
    const { appendBuffer, endOfStream } = enableStreaming()
    player.prepare()
    await player.play('Hello')
    expect(appendBuffer).toHaveBeenCalledTimes(1)
    expect(endOfStream).toHaveBeenCalledTimes(1)
    expect(audio.play.mock.contexts[1]).toBe(audio.play.mock.contexts[0])
    expect(player.loading).toBe(false)
    expect(player.playing).toBe(true)
  })

  it('allows retrying buffered streams when autoplay is blocked', async () => {
    const { player, audio, fetchAudio } = setup()
    enableStreaming()
    audio.play.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    await player.play('Hello')
    expect(player.blocked).toBe(true)
    player.togglePlay()
    await vi.waitFor(() => {
      expect(player.playing).toBe(true)
    })
    expect(fetchAudio).toHaveBeenCalledTimes(1)
    expect(player.errorMessage).toBe('')
  })

  it('still attempts speech when unlocking audio fails', async () => {
    const { player, audio } = setup()
    audio.play.mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    await player.play('Hello')
    expect(player.playing).toBe(true)
    expect(player.errorMessage).toBe('')
  })

  it('ignores a stale play promise when reusing the audio element', async () => {
    const { player, audio } = setup()
    const pending = deferred<void>()
    audio.play.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise)
    const previous = player.play('Old')
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalledTimes(2)
    })
    audio.play.mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    await player.play('New')
    pending.resolve(undefined)
    await previous
    expect(player.playing).toBe(false)
    expect(player.blocked).toBe(true)
  })
})
