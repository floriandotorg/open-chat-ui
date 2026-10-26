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
  const fetchAudio = vi.fn<typeof fetch>().mockResolvedValue(new Response('audio'))
  vi.stubGlobal('fetch', fetchAudio)
  return { audio, fetchAudio, player: createTtsPlayer() }
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
    expect(audio.play).not.toHaveBeenCalled()
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
    expect(audio.play).not.toHaveBeenCalled()
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

  it('allows retrying playback when autoplay is blocked', async () => {
    const { player, audio } = setup()
    audio.play.mockRejectedValueOnce(new Error('Autoplay blocked'))
    await player.play('Hello')
    expect(player.loading).toBe(false)
    expect(player.playing).toBe(false)
    player.togglePlay()
    await vi.waitFor(() => {
      expect(player.playing).toBe(true)
    })
    expect(audio.play).toHaveBeenCalledTimes(2)
  })
})
