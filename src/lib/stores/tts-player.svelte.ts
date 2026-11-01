export const createTtsPlayer = (initialSpeed = 1) => {
  let audio: HTMLAudioElement | undefined = $state()
  let visible = $state(false)
  let playing = $state(false)
  let blocked = $state(false)
  let loading = $state(false)
  let currentTime = $state(0)
  let duration = $state(0)
  let messagePreview = $state('')
  let errorMessage = $state('')
  let speed = $state(initialSpeed)
  let abortController: AbortController | undefined
  let playbackUrl = $state<string>()
  let expiresAt = $state(0)
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  let resumePosition = 0
  let wantsPlayback = false
  let failed = false
  let playAttempt = 0

  const SPEEDS: readonly number[] = [1, 1.25, 1.5, 1.75, 2]
  const SILENT_AUDIO_SOURCE = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA=='

  const cleanup = (releaseAudio = true) => {
    abortController?.abort()
    abortController = undefined
    clearTimeout(retryTimer)
    retryTimer = undefined
    playbackUrl = undefined
    expiresAt = 0
    retries = 0
    resumePosition = 0
    wantsPlayback = false
    failed = false
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (releaseAudio) {
        audio = undefined
      }
    }
    playing = false
    blocked = false
    loading = false
    currentTime = 0
    duration = 0
    errorMessage = ''
  }

  const prepare = () => {
    cleanup()
    const el = new Audio()
    el.preload = 'auto'
    el.playbackRate = speed
    audio = el
    el.src = SILENT_AUDIO_SOURCE
    void el.play().catch(() => {})
    return el
  }

  const resumeAudio = async (el: HTMLAudioElement, signal: AbortSignal) => {
    const attempt = ++playAttempt
    wantsPlayback = true
    try {
      await el.play()
      if (audio === el && !signal.aborted && attempt === playAttempt && wantsPlayback && !failed) {
        playing = true
        loading = false
        blocked = false
        errorMessage = ''
      }
    } catch (cause) {
      if (audio === el && !signal.aborted && attempt === playAttempt && !failed) {
        wantsPlayback = false
        playing = false
        loading = false
        blocked = cause instanceof Error && cause.name === 'NotAllowedError'
        errorMessage = blocked ? 'Playback was blocked by your browser. Press play to listen.' : 'Unable to play audio. Please try again.'
      }
    }
  }

  const loadAudio = async (el: HTMLAudioElement, signal: AbortSignal) => {
    if (!playbackUrl || signal.aborted) {
      return
    }
    failed = false
    loading = true
    blocked = false
    errorMessage = ''
    el.src = playbackUrl
    el.load()
    await resumeAudio(el, signal)
  }

  const listen = (el: HTMLAudioElement, signal: AbortSignal) => {
    const on = (name: string, handler: () => void) => {
      el.addEventListener(
        name,
        () => {
          if (audio === el && !signal.aborted) {
            handler()
          }
        },
        { signal },
      )
    }
    on('timeupdate', () => {
      currentTime = el.currentTime
    })
    on('durationchange', () => {
      if (Number.isFinite(el.duration)) {
        duration = el.duration
      }
    })
    on('loadedmetadata', () => {
      if (resumePosition > 0) {
        try {
          el.currentTime = Number.isFinite(el.duration) ? Math.min(resumePosition, el.duration) : resumePosition
          resumePosition = 0
        } catch {}
      }
    })
    on('waiting', () => {
      loading = wantsPlayback
    })
    on('playing', () => {
      if (wantsPlayback && !failed) {
        playing = true
        loading = false
      }
    })
    on('ended', () => {
      wantsPlayback = false
      playing = false
      loading = false
    })
    on('error', () => {
      if (failed) {
        return
      }
      failed = true
      playing = false
      loading = false
      blocked = false
      resumePosition = Math.max(resumePosition, el.currentTime)
      const recoverable = el.error?.code === 2 || el.error?.code === 3
      if (recoverable && wantsPlayback && retries < 2) {
        loading = true
        retryTimer = setTimeout(
          () => {
            retryTimer = undefined
            void loadAudio(el, signal)
          },
          750 * 2 ** retries,
        )
        ++retries
      } else {
        wantsPlayback = false
        errorMessage = 'Audio interrupted or unavailable. Press play to retry.'
      }
    })
  }

  const play = async (text: string, language?: string) => {
    cleanup(false)
    const el = audio ?? prepare()
    visible = true
    loading = true
    messagePreview = text.slice(0, 100)
    const controller = new AbortController()
    abortController = controller

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }),
        signal: controller.signal,
      })
      if (controller.signal.aborted) {
        return
      }
      const body: unknown = await response.json()
      if (controller.signal.aborted) {
        return
      }
      if (!response.ok) {
        errorMessage = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : 'Unable to generate speech. Please try again.'
        loading = false
        return
      }
      if (typeof body !== 'object' || body === null || !('url' in body) || typeof body.url !== 'string' || !/^\/api\/tts\/[\w-]+$/.test(body.url)) {
        errorMessage = 'Invalid speech response. Please try again.'
        loading = false
        return
      }
      playbackUrl = body.url
      expiresAt = 'expiresAt' in body && typeof body.expiresAt === 'number' ? body.expiresAt : Number.POSITIVE_INFINITY
      listen(el, controller.signal)
      await loadAudio(el, controller.signal)
    } catch {
      if (!controller.signal.aborted) {
        errorMessage = 'Network error. Please try again.'
        loading = false
      }
    }
  }

  const togglePlay = () => {
    if (!audio || !abortController || !playbackUrl) {
      return
    }
    if (wantsPlayback) {
      wantsPlayback = false
      clearTimeout(retryTimer)
      retryTimer = undefined
      audio.pause()
      playing = false
      loading = false
    } else if (failed) {
      retries = 0
      void loadAudio(audio, abortController.signal)
    } else {
      void resumeAudio(audio, abortController.signal)
    }
  }

  const seekRelative = (seconds: number) => {
    if (!audio) {
      return
    }
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds))
  }

  const cycleSpeed = () => {
    const index = SPEEDS.indexOf(speed)
    speed = SPEEDS[(index + 1) % SPEEDS.length]
    if (audio) {
      audio.playbackRate = speed
    }
  }

  const close = () => {
    cleanup()
    visible = false
    messagePreview = ''
  }

  return {
    get canReplay() {
      return Boolean(playbackUrl) && Date.now() < expiresAt
    },
    get visible() {
      return visible
    },
    get playing() {
      return playing
    },
    get blocked() {
      return blocked
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
    prepare,
    play,
    togglePlay,
    seekRelative,
    cycleSpeed,
    close,
  }
}
