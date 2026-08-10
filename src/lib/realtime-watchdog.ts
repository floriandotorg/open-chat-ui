import { pbClient } from '$lib/pb-client'
import { browser } from '$app/environment'

const HEARTBEAT_COLLECTION = 'heartbeat'
const STALL_MS = 45_000
// One missed server beat (15s interval) plus grace: on resume we don't wait
// for the full stall window because backgrounded PWAs get their SSE
// connection suspended silently.
const RESUME_STALE_MS = 25_000
const CHECK_INTERVAL_MS = 10_000

export interface RealtimeRegistration {
  subscribe: () => void | Promise<void>
  unsubscribe: () => void
  resync?: () => void | Promise<void>
}

const registrations = new Set<RealtimeRegistration>()

let lastEventAt = Date.now()
let heartbeatUnsub: (() => void) | null = null
let recovering = false
let started = false

export const registerRealtime = (...entries: RealtimeRegistration[]): (() => void) => {
  for (const entry of entries) registrations.add(entry)
  return () => {
    for (const entry of entries) registrations.delete(entry)
  }
}

let heartbeatPromise: Promise<void> | null = null

const ensureHeartbeat = () => {
  if (heartbeatUnsub) return Promise.resolve()
  heartbeatPromise ??= (async () => {
    try {
      heartbeatUnsub = await pbClient.collection(HEARTBEAT_COLLECTION).subscribe('*', () => {
        lastEventAt = Date.now()
      })
    } catch {
      heartbeatUnsub = null
    } finally {
      heartbeatPromise = null
    }
  })()
  return heartbeatPromise
}

const recover = async () => {
  if (recovering) return
  recovering = true
  try {
    heartbeatUnsub?.()
    heartbeatUnsub = null
    for (const entry of registrations) {
      try {
        entry.unsubscribe()
      } catch {}
    }
    // Removing the last subscription auto-closes the SSE connection, so the
    // re-subscribes below start from a fresh connection and clientId.
    await pbClient.realtime.unsubscribe()
    await ensureHeartbeat()
    for (const entry of registrations) {
      try {
        await entry.subscribe()
      } catch {}
    }
    // Events fired while the connection was dead cannot be replayed, so each
    // registration re-pulls its data after re-subscribing.
    for (const entry of registrations) {
      try {
        await entry.resync?.()
      } catch {}
    }
    lastEventAt = Date.now()
  } finally {
    recovering = false
  }
}

const check = () => {
  if (!browser || !navigator.onLine || document.visibilityState !== 'visible') return
  if (!heartbeatUnsub || Date.now() - lastEventAt > STALL_MS) {
    void recover()
  }
}

const onResume = () => {
  if (!browser || !navigator.onLine || document.visibilityState !== 'visible') return
  if (!heartbeatUnsub || Date.now() - lastEventAt > RESUME_STALE_MS) {
    void recover()
  }
}

export const startRealtimeWatchdog = () => {
  if (!browser || started) return
  started = true
  void ensureHeartbeat()
  setInterval(check, CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', onResume)
  window.addEventListener('pageshow', onResume)
  window.addEventListener('online', onResume)
}

export interface RealtimeSlot extends RealtimeRegistration {
  cancel: () => void
}

export const createRealtimeSlot = (subscribeFn: () => Promise<() => void>, resyncFn?: (isCurrent: () => boolean) => void | Promise<void>): RealtimeSlot => {
  let unsub: (() => void) | null = null
  let generation = 0
  let cancelled = false
  return {
    resync: resyncFn
      ? async () => {
          if (cancelled) return
          const g = generation
          await resyncFn(() => !cancelled && g === generation)
        }
      : undefined,
    subscribe: async () => {
      if (cancelled) return
      const g = ++generation
      try {
        const u = await subscribeFn()
        if (cancelled || g !== generation) {
          u()
          return
        }
        unsub = u
      } catch (err) {
        console.warn('[realtime] subscribe failed', err)
      }
    },
    unsubscribe: () => {
      ++generation
      unsub?.()
      unsub = null
    },
    cancel: () => {
      cancelled = true
      ++generation
      unsub?.()
      unsub = null
    },
  }
}
