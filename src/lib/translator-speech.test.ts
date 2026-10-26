import { createTranslatorSpeech } from './translator-speech'
import { afterEach, describe, expect, it, vi } from 'vitest'

const setup = (session: { provider: string; token: string; model?: string } = { provider: 'elevenlabs', token: 'temporary' }) => {
  const streams: { getTracks: () => { stop: ReturnType<typeof vi.fn> }[]; getAudioTracks: () => [] }[] = []
  const pending: ((stream: (typeof streams)[number]) => void)[] = []
  const sockets: MockSocket[] = []
  const loadWorklet = vi.fn(async () => {})
  const resumeAudio = vi.fn(async () => {})
  class MockSocket {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    send = vi.fn()
    close = vi.fn()
    constructor(public url: string) {
      sockets.push(this)
    }
  }
  class MockAudio {
    state = 'running'
    destination = {}
    audioWorklet = { addModule: loadWorklet }
    resume = resumeAudio
    close = async () => {
      this.state = 'closed'
    }
    createMediaStreamSource = () => ({ connect: vi.fn() })
  }
  class MockProcessor {
    port = { onmessage: null, postMessage: vi.fn() }
    connect = vi.fn()
    disconnect = vi.fn()
  }
  vi.stubGlobal('window', { AudioWorkletNode: MockProcessor })
  vi.stubGlobal('AudioContext', MockAudio)
  vi.stubGlobal('AudioWorkletNode', MockProcessor)
  vi.stubGlobal('WebSocket', MockSocket)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise(resolve => {
          pending.push(resolve)
        }),
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => session })),
  )
  const callbacks = { state: vi.fn(), text: vi.fn(), error: vi.fn() }
  const speech = createTranslatorSpeech(callbacks)
  const grantMicrophone = (index: number) => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track], getAudioTracks: (): [] => [] }
    streams.push(stream)
    pending[index]?.(stream)
    return track
  }
  return { speech, callbacks, grantMicrophone, sockets, loadWorklet, resumeAudio }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live translator speech', () => {
  it('discards a cancelled microphone permission request even after a new session starts', async () => {
    const { speech, grantMicrophone, sockets } = setup()
    const first = speech.start('th')
    await Promise.resolve()
    speech.dispose()
    const second = speech.start('th')
    await Promise.resolve()
    const oldTrack = grantMicrophone(0)
    await first
    const newTrack = grantMicrophone(1)
    await second
    speech.dispose()
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(sockets).toHaveLength(1)
    expect(newTrack.stop).toHaveBeenCalledOnce()
  })

  it('prepares the session and audio worklet while microphone permission is pending', async () => {
    const { speech, grantMicrophone, sockets, loadWorklet, resumeAudio } = setup()
    const started = speech.start('th')
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledOnce()
    expect(loadWorklet).toHaveBeenCalledWith('/translator-audio.js')
    expect(resumeAudio).toHaveBeenCalledOnce()
    expect(sockets).toHaveLength(0)
    grantMicrophone(0)
    await started
    expect(sockets).toHaveLength(1)
    speech.dispose()
  })

  it('stops a late microphone stream when parallel session setup fails', async () => {
    const { speech, callbacks, grantMicrophone, sockets } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Session unavailable')
      }),
    )
    const started = speech.start('th')
    await vi.waitFor(() => expect(callbacks.error).toHaveBeenCalledWith('Session unavailable'), { timeout: 100 })
    await started
    expect(callbacks.state).toHaveBeenLastCalledWith('idle')
    const track = grantMicrophone(0)
    await Promise.resolve()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(sockets).toHaveLength(0)
  })

  it('waits for audio preparation and session credentials before connecting', async () => {
    const { speech, callbacks, grantMicrophone, sockets, loadWorklet } = setup()
    const worklet = Promise.withResolvers<void>()
    loadWorklet.mockReturnValue(worklet.promise)
    const started = speech.start('th')
    await Promise.resolve()
    grantMicrophone(0)
    await Promise.resolve()
    expect(sockets).toHaveLength(0)
    worklet.resolve()
    await started
    expect(sockets).toHaveLength(1)
    expect(callbacks.error).not.toHaveBeenCalled()
    speech.dispose()
  })

  it('starts Mistral with automatic language detection and receives the live transcript', async () => {
    const { speech, callbacks, grantMicrophone, sockets } = setup({ provider: 'mistral', token: 'temporary', model: 'voxtral-mini-transcribe-realtime-2602' })
    const started = speech.start('de')
    await Promise.resolve()
    grantMicrophone(0)
    await started
    const socket = sockets[0]
    socket?.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) })
    expect(socket?.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 16000 }, target_streaming_delay_ms: 500 } }))
    socket?.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) })
    expect(callbacks.state).toHaveBeenLastCalledWith('recording')
    socket?.onmessage?.({ data: JSON.stringify({ type: 'transcription.text.delta', text: 'Guten ' }) })
    socket?.onmessage?.({ data: JSON.stringify({ type: 'transcription.text.delta', text: 'Tag' }) })
    socket?.onmessage?.({ data: JSON.stringify({ type: 'transcription.done', text: 'Guten Tag.' }) })
    expect(callbacks.text.mock.calls.map(call => call[0])).toEqual(['Guten ', 'Guten Tag', 'Guten Tag.'])
    expect(callbacks.state).toHaveBeenLastCalledWith('idle')
    expect(callbacks.error).not.toHaveBeenCalled()
    expect(socket?.close).toHaveBeenCalledOnce()
    speech.dispose()
  })

  it('uses Thai for ElevenLabs and replaces partial text with the committed transcript', async () => {
    const { speech, callbacks, grantMicrophone, sockets } = setup()
    const started = speech.start('th')
    await Promise.resolve()
    grantMicrophone(0)
    await started
    const socket = sockets[0]
    socket?.onmessage?.({ data: JSON.stringify({ message_type: 'partial_transcript', text: 'สวัส' }) })
    socket?.onmessage?.({ data: JSON.stringify({ message_type: 'committed_transcript', text: 'สวัสดี' }) })
    speech.dispose()
    expect(socket?.url).toContain('language_code=th')
    expect(callbacks.text.mock.calls.map(call => call[0])).toEqual(['สวัส', 'สวัสดี'])
    expect(callbacks.error).not.toHaveBeenCalled()
  })
})
