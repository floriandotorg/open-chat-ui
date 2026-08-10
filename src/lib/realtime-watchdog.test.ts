import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const realtimeUnsubscribe = vi.fn()
const heartbeatSubscribe = vi.fn()

vi.mock('$lib/pb-client', () => ({
  pbClient: {
    collection: vi.fn((name: string) => {
      if (name !== 'heartbeat') throw new Error(`unexpected collection ${name}`)
      return { subscribe: heartbeatSubscribe }
    }),
    realtime: { unsubscribe: realtimeUnsubscribe },
  },
}))

vi.mock('$app/environment', () => ({ browser: true }))

const loadWatchdog = async () => {
  vi.resetModules()
  return await import('./realtime-watchdog')
}

describe('realtime watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    realtimeUnsubscribe.mockReset()
    heartbeatSubscribe.mockReset()
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() })
    vi.stubGlobal('window', { addEventListener: vi.fn() })
    vi.stubGlobal('navigator', { onLine: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('subscribes to the heartbeat collection on start', async () => {
    heartbeatSubscribe.mockResolvedValue(vi.fn())
    const watchdog = await loadWatchdog()
    watchdog.startRealtimeWatchdog()
    await vi.advanceTimersByTimeAsync(0)
    expect(heartbeatSubscribe).toHaveBeenCalledTimes(1)
    expect(realtimeUnsubscribe).not.toHaveBeenCalled()
  })

  it('does not recover while heartbeats keep arriving', async () => {
    let onBeat: (() => void) | undefined
    heartbeatSubscribe.mockImplementation((_topic: string, cb: () => void) => {
      onBeat = cb
      return Promise.resolve(vi.fn())
    })
    const watchdog = await loadWatchdog()
    watchdog.startRealtimeWatchdog()
    await vi.advanceTimersByTimeAsync(0)

    for (let n = 0; n < 10; ++n) {
      await vi.advanceTimersByTimeAsync(14_000)
      onBeat?.()
    }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(realtimeUnsubscribe).not.toHaveBeenCalled()
  })

  it('recovers by disconnecting and re-subscribing everything after a stall', async () => {
    let onBeat: (() => void) | undefined
    heartbeatSubscribe.mockImplementation((_topic: string, cb: () => void) => {
      onBeat = cb
      return Promise.resolve(vi.fn())
    })
    const watchdog = await loadWatchdog()
    watchdog.startRealtimeWatchdog()
    await vi.advanceTimersByTimeAsync(0)
    onBeat?.()

    const subscribe = vi.fn()
    const unsubscribe = vi.fn()
    watchdog.registerRealtime({ subscribe, unsubscribe })

    await vi.advanceTimersByTimeAsync(51_000)

    expect(realtimeUnsubscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(heartbeatSubscribe).toHaveBeenCalledTimes(2)
  })

  it('calls resync on registrations after recovering', async () => {
    heartbeatSubscribe.mockResolvedValue(vi.fn())
    const watchdog = await loadWatchdog()
    watchdog.startRealtimeWatchdog()
    await vi.advanceTimersByTimeAsync(0)

    const resync = vi.fn()
    watchdog.registerRealtime({ subscribe: vi.fn(), unsubscribe: vi.fn(), resync })

    await vi.advanceTimersByTimeAsync(51_000)
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('recovers on resume when the heartbeat went stale while backgrounded', async () => {
    let onBeat: (() => void) | undefined
    heartbeatSubscribe.mockImplementation((_topic: string, cb: () => void) => {
      onBeat = cb
      return Promise.resolve(vi.fn())
    })
    let visibilityHandler: (() => void) | undefined
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'visibilitychange') visibilityHandler = handler
      }),
    })
    const watchdog = await loadWatchdog()
    watchdog.startRealtimeWatchdog()
    await vi.advanceTimersByTimeAsync(0)
    onBeat?.()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(realtimeUnsubscribe).not.toHaveBeenCalled()

    visibilityHandler?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(realtimeUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('recovers when the heartbeat subscription is missing', async () => {
    heartbeatSubscribe.mockRejectedValue(new Error('network down'))
    const watchdog = await loadWatchdog()
    watchdog.startRealtimeWatchdog()
    await vi.advanceTimersByTimeAsync(0)

    const subscribe = vi.fn()
    const unsubscribe = vi.fn()
    watchdog.registerRealtime({ subscribe, unsubscribe })

    heartbeatSubscribe.mockResolvedValue(vi.fn())
    await vi.advanceTimersByTimeAsync(11_000)
    expect(realtimeUnsubscribe).toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalled()
  })

  it('does not recover while the tab is hidden', async () => {
    heartbeatSubscribe.mockResolvedValue(vi.fn())
    const watchdog = await loadWatchdog()
    watchdog.startRealtimeWatchdog()
    await vi.advanceTimersByTimeAsync(0)

    vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: vi.fn() })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(realtimeUnsubscribe).not.toHaveBeenCalled()
  })
})
