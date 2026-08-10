import { pbClient } from '$lib/pb-client'
import { browser } from '$app/environment'

const HEARTBEAT_COLLECTION = 'heartbeat'
const STALL_MS = 45_000
const CHECK_INTERVAL_MS = 10_000

export interface RealtimeRegistration {
  subscribe: () => void | Promise<void>
  unsubscribe: () => void
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

const ensureHeartbeat = async () => {
  if (heartbeatUnsub) return
  try {
    heartbeatUnsub = await pbClient.collection(HEARTBEAT_COLLECTION).subscribe('*', () => {
      lastEventAt = Date.now()
    })
  } catch {
    heartbeatUnsub = null
  }
}

const recover = async () => {
  if (recovering) return
  recovering = true
  lastEventAt = Date.now()
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
    for (const entry of registrations) {
      try {
        await entry.subscribe()
      } catch {}
    }
    await ensureHeartbeat()
  } finally {
    recovering = false
  }
}

const check = () => {
  if (!browser || !navigator.onLine || document.visibilityState !== 'visible') return
  if (!heartbeatUnsub) {
    void ensureHeartbeat()
    return
  }
  if (Date.now() - lastEventAt > STALL_MS) {
    void recover()
  }
}

export const startRealtimeWatchdog = () => {
  if (!browser || started) return
  started = true
  void ensureHeartbeat()
  setInterval(check, CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.addEventListener('pageshow', check)
  window.addEventListener('online', check)
}

export interface RealtimeSlot extends RealtimeRegistration {
  cancel: () => void
}

export const createRealtimeSlot = (subscribeFn: () => Promise<() => void>): RealtimeSlot => {
  let unsub: (() => void) | null = null
  let generation = 0
  let cancelled = false
  return {
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
