import { createTtsPlayer } from './tts-player.svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(complete => {
    resolve = complete
  })
  return { promise, resolve }
}

const players: ReturnType<typeof createTtsPlayer>[] = []
const setup = () => {
  let mediaError: { code: number } | undefined
  const audio = Object.assign(new EventTarget(), {
    playbackRate: 1,
    preload: '',
    src: '',
    currentTime: 0,
    duration: 60,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  })
  Object.defineProperty(audio, 'error', { get: () => mediaError })
  audio.removeAttribute.mockImplementation(() => {
    audio.src = ''
  })
  audio.load.mockImplementation(() => {
    audio.currentTime = 0
  })
  vi.stubGlobal('Audio', new Proxy(class {}, { construct: () => audio }))
  vi.stubGlobal('MediaSource', undefined)
  const fetchAudio = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ url: '/api/tts/speech-1' }, { status: 201 }))
  vi.stubGlobal('fetch', fetchAudio)
  const player = createTtsPlayer()
  players.push(player)
  const emit = (name: string) => audio.dispatchEvent(new Event(name))
  const fail = (code: number) => {
    mediaError = { code }
    emit('error')
  }
  return { audio, fetchAudio, player, emit, fail }
}

afterEach(() => {
  for (const player of players.splice(0)) {
    player.close()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('native translated text playback', () => {
  it('sends the target language and assigns the protected URL directly to the native player', async () => {
    const { player, fetchAudio, audio } = setup()
    await player.play('สวัสดี', 'th')
    expect(fetchAudio).toHaveBeenCalledWith('/api/tts', expect.objectContaining({ body: JSON.stringify({ text: 'สวัสดี', language: 'th' }) }))
    expect(audio.src).toBe('/api/tts/speech-1')
    expect(audio.preload).toBe('auto')
    expect(player.playing).toBe(true)
    expect(player.loading).toBe(false)
  })

  it('ignores responses that arrive after the player closes', async () => {
    const { player, audio, fetchAudio } = setup()
    const pending = deferred<Response>()
    fetchAudio.mockReturnValue(pending.promise)
    const playback = player.play('Hello')
    player.close()
    pending.resolve(Response.json({ url: '/api/tts/old' }))
    await playback
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe('')
    expect(player.visible).toBe(false)
    expect(player.playing).toBe(false)
  })

  it('ignores a playback URL parsed after close', async () => {
    const { player, audio, fetchAudio } = setup()
    const pending = deferred<unknown>()
    const response = Response.json({})
    const readJson = vi.spyOn(response, 'json').mockReturnValue(pending.promise)
    fetchAudio.mockResolvedValue(response)
    const playback = player.play('Hello')
    await vi.waitFor(() => {
      expect(readJson).toHaveBeenCalled()
    })
    player.close()
    pending.resolve({ url: '/api/tts/old' })
    await playback
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe('')
  })

  it('keeps newer playback when an older request fails', async () => {
    const { player, fetchAudio, audio } = setup()
    const pending = deferred<Response>()
    fetchAudio.mockReturnValueOnce(pending.promise)
    const previous = player.play('Old')
    await player.play('New')
    pending.resolve(Response.json({ message: 'Old request failed' }, { status: 400 }))
    await previous
    expect(player.errorMessage).toBe('')
    expect(player.playing).toBe(true)
    expect(audio.src).toBe('/api/tts/speech-1')
  })

  it('unlocks audio before requesting speech', async () => {
    const { player, audio, fetchAudio } = setup()
    const pending = deferred<Response>()
    fetchAudio.mockReturnValue(pending.promise)
    const playback = player.play('Hello')
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.play.mock.invocationCallOrder[0]).toBeLessThan(fetchAudio.mock.invocationCallOrder[0])
    pending.resolve(Response.json({ url: '/api/tts/speech-1' }))
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

  it('shows buffering during a stall and clears it when playback resumes', async () => {
    const { player, emit } = setup()
    await player.play('Hello')
    emit('waiting')
    expect(player.loading).toBe(true)
    emit('playing')
    expect(player.loading).toBe(false)
    expect(player.playing).toBe(true)
  })

  it('updates progress and finishes without marking normal completion as a network error', async () => {
    const { player, audio, emit } = setup()
    await player.play('Hello')
    audio.currentTime = 12
    emit('timeupdate')
    emit('durationchange')
    expect(player.currentTime).toBe(12)
    expect(player.duration).toBe(60)
    emit('ended')
    expect(player.playing).toBe(false)
    expect(player.loading).toBe(false)
    expect(player.errorMessage).toBe('')
    expect(player.canReplay).toBe(true)
    player.togglePlay()
    await Promise.resolve()
    expect(player.playing).toBe(true)
  })

  it('stops offering cached replay after the protected URL expires', async () => {
    vi.useFakeTimers()
    const { player, fetchAudio } = setup()
    fetchAudio.mockResolvedValueOnce(Response.json({ url: '/api/tts/speech-1', expiresAt: Date.now() + 1000 }))
    await player.play('Hello')
    expect(player.canReplay).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(player.canReplay).toBe(false)
    player.close()
    expect(player.canReplay).toBe(false)
  })

  it('retries interrupted playback using the same cached URL and playback position', async () => {
    vi.useFakeTimers()
    const { player, audio, fetchAudio, fail, emit } = setup()
    await player.play('Hello')
    audio.currentTime = 12
    fail(2)
    expect(player.loading).toBe(true)
    await vi.advanceTimersByTimeAsync(750)
    expect(audio.src).toBe('/api/tts/speech-1')
    emit('loadedmetadata')
    expect(audio.currentTime).toBe(12)
    expect(fetchAudio).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(3)
  })

  it('bounds automatic retries and offers a manual retry without regenerating speech', async () => {
    vi.useFakeTimers()
    const { player, audio, fetchAudio, fail } = setup()
    await player.play('Hello')
    fail(2)
    await vi.advanceTimersByTimeAsync(750)
    fail(3)
    await vi.advanceTimersByTimeAsync(1500)
    fail(2)
    expect(player.loading).toBe(false)
    expect(player.errorMessage).toContain('Press play to retry')
    expect(audio.play).toHaveBeenCalledTimes(4)
    player.togglePlay()
    await Promise.resolve()
    expect(fetchAudio).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(5)
  })

  it('does not automatically retry unsupported audio', async () => {
    vi.useFakeTimers()
    const { player, audio, fail } = setup()
    await player.play('Hello')
    fail(4)
    await vi.advanceTimersByTimeAsync(5000)
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(player.loading).toBe(false)
    expect(player.errorMessage).toContain('Press play to retry')
  })

  it('cancels scheduled retries when closed', async () => {
    vi.useFakeTimers()
    const { player, audio, fail } = setup()
    await player.play('Hello')
    fail(2)
    player.close()
    await vi.advanceTimersByTimeAsync(5000)
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(player.visible).toBe(false)
  })

  it('cancels scheduled retries when a new message starts playing', async () => {
    vi.useFakeTimers()
    const { player, audio, fetchAudio, fail } = setup()
    await player.play('Old')
    fail(2)
    fetchAudio.mockResolvedValueOnce(Response.json({ url: '/api/tts/new' }))
    await player.play('New')
    await vi.advanceTimersByTimeAsync(5000)
    expect(audio.src).toBe('/api/tts/new')
    expect(audio.play).toHaveBeenCalledTimes(3)
    expect(player.errorMessage).toBe('')
  })

  it.each([{}, { url: 'https://example.com/audio.mp3' }, { url: '/api/tts/../private' }])('rejects malformed or external playback URLs %j', async body => {
    const { player, fetchAudio, audio } = setup()
    fetchAudio.mockResolvedValueOnce(Response.json(body))
    await player.play('Hello')
    expect(player.loading).toBe(false)
    expect(player.playing).toBe(false)
    expect(player.errorMessage).not.toBe('')
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it('shows synthesis failures without leaving the player loading', async () => {
    const { player, fetchAudio } = setup()
    fetchAudio.mockResolvedValueOnce(Response.json({ message: 'No API key configured' }, { status: 400 }))
    await player.play('Hello')
    expect(player.loading).toBe(false)
    expect(player.errorMessage).toBe('No API key configured')
  })

  it('handles network failures without leaving the player loading', async () => {
    const { player, fetchAudio } = setup()
    fetchAudio.mockRejectedValueOnce(new Error('Offline'))
    await player.play('Hello')
    expect(player.loading).toBe(false)
    expect(player.errorMessage).toContain('Network error')
  })
})
