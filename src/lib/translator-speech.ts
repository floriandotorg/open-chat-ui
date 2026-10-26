export type SpeechState = 'idle' | 'connecting' | 'recording' | 'finishing'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const createTranslatorSpeech = (callbacks: { text: (text: string) => void; state: (state: SpeechState) => void; error: (message: string) => void }) => {
  let socket: WebSocket | undefined
  let audio: AudioContext | undefined
  let microphone: MediaStream | undefined
  let processor: AudioWorkletNode | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let limit: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  let generation = 0
  let finishing = false
  let transcript = ''
  let provider = ''
  let abort: AbortController | undefined

  const dispose = () => {
    cancelled = true
    ++generation
    clearTimeout(timeout)
    clearTimeout(limit)
    abort?.abort()
    processor?.disconnect()
    microphone?.getTracks().forEach(track => {
      track.stop()
    })
    if (audio && audio.state !== 'closed') {
      void audio.close()
    }
    processor = undefined
    microphone = undefined
    audio = undefined
    if (socket) {
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      socket.close()
    }
    socket = undefined
    callbacks.state('idle')
  }

  const fail = (message: string) => {
    if (!cancelled) {
      callbacks.error(message)
      dispose()
    }
  }

  const send = (payload: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) {
      if (socket.bufferedAmount > 1_000_000) {
        fail('Connection is too slow for live transcription. Please try again.')
        return
      }
      socket.send(JSON.stringify(payload))
    }
  }

  const stop = () => {
    if (finishing || cancelled) {
      return
    }
    if (!processor) {
      dispose()
      return
    }
    finishing = true
    callbacks.state('finishing')
    processor.port.postMessage('flush')
    timeout = setTimeout(() => fail('The final transcript timed out. Your live text has been kept.'), 8000)
  }

  const start = async (language: string) => {
    const currentGeneration = ++generation
    const active = () => !cancelled && generation === currentGeneration
    cancelled = false
    finishing = false
    transcript = ''
    callbacks.state('connecting')
    abort = new AbortController()
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
        throw new Error('Live transcription needs microphone access in a secure, supported browser')
      }
      const context = new AudioContext()
      audio = context
      const streamReady = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(stream => {
        if (!active()) {
          stream.getTracks().forEach(track => {
            track.stop()
          })
          return
        }
        microphone = stream
        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (active() && !finishing) {
            fail('Microphone disconnected')
          }
        })
      })
      const sessionReady = fetch('/api/translator/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language }), signal: abort.signal }).then(async response => {
        const data: unknown = await response.json()
        if (!response.ok) {
          throw new Error(isRecord(data) && typeof data.message === 'string' ? data.message : 'Could not start transcription')
        }
        if (!isRecord(data) || typeof data.token !== 'string' || (data.provider !== 'elevenlabs' && data.provider !== 'mistral') || (data.provider === 'mistral' && typeof data.model !== 'string')) {
          throw new Error('Invalid live transcription session')
        }
        return { provider: data.provider, token: data.token, model: typeof data.model === 'string' ? data.model : undefined }
      })
      const [data] = await Promise.all([sessionReady, streamReady, context.resume(), context.audioWorklet.addModule('/translator-audio.js')])
      if (!active()) {
        return
      }
      provider = data.provider
      const url =
        provider === 'elevenlabs'
          ? `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${new URLSearchParams({ model_id: 'scribe_v2_realtime', token: data.token, audio_format: 'pcm_16000', language_code: language, commit_strategy: 'manual' })}`
          : `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(typeof data.model === 'string' ? data.model : '')}`
      socket = provider === 'elevenlabs' ? new WebSocket(url) : new WebSocket(url, ['realtime', data.token])
      timeout = setTimeout(() => fail('Live transcription connection timed out'), 15_000)
      socket.onerror = () => fail('Live transcription connection failed')
      socket.onclose = () => fail('Live transcription disconnected. Your text has been kept.')
      socket.onmessage = event => {
        if (!active()) {
          return
        }
        const data: unknown = JSON.parse(event.data)
        if (!isRecord(data)) {
          fail('Invalid live transcription response')
          return
        }
        const type = typeof data.type === 'string' ? data.type : typeof data.message_type === 'string' ? data.message_type : ''
        if (type === 'session.created') {
          send({ type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 16000 }, target_streaming_delay_ms: 500 } })
        }
        if ((type === 'session.updated' || type === 'session_started') && !processor && audio && microphone) {
          clearTimeout(timeout)
          processor = new AudioWorkletNode(audio, 'translator-audio')
          processor.port.onmessage = event => {
            if (event.data === 'flushed') {
              microphone?.getTracks().forEach(track => {
                track.stop()
              })
              if (provider === 'elevenlabs') {
                send({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 })
              } else {
                send({ type: 'input_audio.flush' })
                send({ type: 'input_audio.end' })
              }
              return
            }
            const bytes = new Uint8Array(event.data)
            let binary = ''
            for (let n = 0; n < bytes.length; ++n) {
              binary += String.fromCharCode(bytes[n])
            }
            const encoded = btoa(binary)
            send(provider === 'elevenlabs' ? { message_type: 'input_audio_chunk', audio_base_64: encoded, sample_rate: 16000 } : { type: 'input_audio.append', audio: encoded })
          }
          audio.createMediaStreamSource(microphone).connect(processor)
          processor.connect(audio.destination)
          callbacks.state('recording')
          limit = setTimeout(stop, 180_000)
        }
        if (type === 'transcription.text.delta' && typeof data.text === 'string') {
          transcript += data.text
          callbacks.text(transcript)
        }
        if (type === 'partial_transcript' && typeof data.text === 'string') {
          callbacks.text(transcript + data.text)
        }
        if (type === 'committed_transcript' && typeof data.text === 'string') {
          transcript += data.text
          callbacks.text(transcript)
          if (finishing) {
            dispose()
          }
        }
        if (type === 'transcription.done') {
          if (typeof data.text === 'string') {
            callbacks.text(data.text)
          }
          dispose()
        }
        if (type === 'error' || type.includes('error')) {
          const detail = isRecord(data.error) ? data.error.message : (data.error ?? data.message)
          fail(typeof detail === 'string' ? detail : 'Live transcription failed')
        }
      }
    } catch (error) {
      if (active()) {
        fail(error instanceof Error ? error.message : 'Microphone access failed')
      }
    }
  }

  return { start, stop, dispose }
}
