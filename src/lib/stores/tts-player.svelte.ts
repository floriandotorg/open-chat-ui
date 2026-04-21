export const createTtsPlayer = () => {
  let audio: HTMLAudioElement | undefined = $state()
  let objectUrl = $state<string>()
  let visible = $state(false)
  let playing = $state(false)
  let loading = $state(false)
  let currentTime = $state(0)
  let duration = $state(0)
  let messagePreview = $state('')
  let errorMessage = $state('')
  let speed = $state(1)
  let abortController: AbortController | undefined

  const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const
  const MIME_TYPE = 'audio/mpeg'

  const cleanup = () => {
    abortController?.abort()
    abortController = undefined
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio = undefined
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = undefined
    }
    playing = false
    loading = false
    currentTime = 0
    duration = 0
    errorMessage = ''
  }

  const createAudioElement = () => {
    const el = new Audio()
    el.playbackRate = speed
    el.addEventListener('timeupdate', () => {
      currentTime = el.currentTime
    })
    el.addEventListener('durationchange', () => {
      if (Number.isFinite(el.duration)) {
        duration = el.duration
      }
    })
    el.addEventListener('ended', () => {
      playing = false
    })
    el.addEventListener('error', () => {
      if (!errorMessage) errorMessage = 'Playback error'
      playing = false
      loading = false
    })
    return el
  }

  const streamViaMediaSource = (body: ReadableStream<Uint8Array>, el: HTMLAudioElement) =>
    new Promise<void>((resolve, reject) => {
      const mediaSource = new MediaSource()
      objectUrl = URL.createObjectURL(mediaSource)
      el.src = objectUrl

      const onSourceOpen = async () => {
        mediaSource.removeEventListener('sourceopen', onSourceOpen)
        const sourceBuffer = mediaSource.addSourceBuffer(MIME_TYPE)

        const appendChunk = (chunk: Uint8Array) =>
          new Promise<void>((res2, rej2) => {
            const onEnd = () => {
              sourceBuffer.removeEventListener('updateend', onEnd)
              sourceBuffer.removeEventListener('error', onErr)
              res2()
            }
            const onErr = (e: Event) => {
              sourceBuffer.removeEventListener('updateend', onEnd)
              sourceBuffer.removeEventListener('error', onErr)
              rej2(e)
            }
            sourceBuffer.addEventListener('updateend', onEnd)
            sourceBuffer.addEventListener('error', onErr)
            const copy = new Uint8Array(chunk.byteLength)
            copy.set(chunk)
            sourceBuffer.appendBuffer(copy)
          })

        const reader = body.getReader()
        let started = false

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            await appendChunk(value)
            if (!started) {
              started = true
              loading = false
              playing = true
              el.play().catch(() => {})
            }
          }
          if (mediaSource.readyState === 'open') {
            mediaSource.endOfStream()
          }
          resolve()
        } catch (err) {
          reject(err)
        }
      }

      mediaSource.addEventListener('sourceopen', onSourceOpen)
    })

  const fallbackPlay = async (res: Response, el: HTMLAudioElement) => {
    const blob = await res.blob()
    objectUrl = URL.createObjectURL(blob)
    el.src = objectUrl
    loading = false
    playing = true
    el.play().catch(() => {})
  }

  const play = async (text: string) => {
    cleanup()
    visible = true
    loading = true
    messagePreview = text.slice(0, 100)
    errorMessage = ''

    abortController = new AbortController()

    let res: Response
    try {
      res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: abortController.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      errorMessage = 'Network error'
      loading = false
      return
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }))
      errorMessage = body.message ?? 'TTS failed'
      loading = false
      return
    }

    if (!res.body) {
      errorMessage = 'No audio data'
      loading = false
      return
    }

    const el = createAudioElement()
    audio = el

    const canStream = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MIME_TYPE)

    try {
      if (canStream) {
        await streamViaMediaSource(res.body, el)
      } else {
        await fallbackPlay(res, el)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (!errorMessage) errorMessage = 'Stream error'
      loading = false
    }
  }

  const togglePlay = () => {
    if (!audio) return
    if (playing) {
      audio.pause()
      playing = false
    } else {
      audio.play().catch(() => {})
      playing = true
    }
  }

  const seekRelative = (seconds: number) => {
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds))
  }

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed as (typeof SPEEDS)[number])
    speed = SPEEDS[(idx + 1) % SPEEDS.length]
    if (audio) audio.playbackRate = speed
  }

  const close = () => {
    cleanup()
    visible = false
    messagePreview = ''
  }

  return {
    get visible() {
      return visible
    },
    get playing() {
      return playing
    },
    get loading() {
      return loading
    },
    get currentTime() {
      return currentTime
    },
    get duration() {
      return duration
    },
    get messagePreview() {
      return messagePreview
    },
    get errorMessage() {
      return errorMessage
    },
    get speed() {
      return speed
    },
    play,
    togglePlay,
    seekRelative,
    cycleSpeed,
    close,
  }
}
