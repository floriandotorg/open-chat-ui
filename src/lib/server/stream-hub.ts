import type { ChatStreamEvent } from '$lib/server/providers/types'

export type HubEvent = ChatStreamEvent

export interface StreamHub {
  conversationId: string
  userId: string
  events: HubEvent[]
  done: boolean
  abort: AbortController
  subscribers: Set<(event: HubEvent, index: number) => void>
  startedAt: number
}

const hubs = new Map<string, StreamHub>()

export const getHub = (conversationId: string): StreamHub | undefined => hubs.get(conversationId)

export const createHub = (conversationId: string, userId: string): StreamHub => {
  const existing = hubs.get(conversationId)
  if (existing) {
    return existing
  }
  const hub: StreamHub = {
    conversationId,
    userId,
    events: [],
    done: false,
    abort: new AbortController(),
    subscribers: new Set(),
    startedAt: Date.now(),
  }
  hubs.set(conversationId, hub)
  return hub
}

export const emit = (hub: StreamHub, event: HubEvent) => {
  const index = hub.events.length
  hub.events.push(event)
  for (const sub of hub.subscribers) {
    try {
      sub(event, index)
    } catch {}
  }
}

export const finishHub = (hub: StreamHub) => {
  if (hub.done) return
  hub.done = true
  emit(hub, { type: 'stream_end' })
  hubs.delete(hub.conversationId)
}

export const abortHub = (conversationId: string) => {
  const hub = hubs.get(conversationId)
  if (!hub) return false
  hub.abort.abort()
  return true
}

export interface SubscribeOptions {
  cursor?: number
  onEvent: (event: HubEvent, index: number) => void
  onClose: () => void
}

export const subscribe = (hub: StreamHub, { cursor = 0, onEvent, onClose }: SubscribeOptions): (() => void) => {
  for (let n = cursor; n < hub.events.length; ++n) {
    onEvent(hub.events[n], n)
  }
  if (hub.done) {
    onClose()
    return () => {}
  }
  const handler = (event: HubEvent, index: number) => {
    onEvent(event, index)
    if (event.type === 'stream_end') {
      hub.subscribers.delete(handler)
      onClose()
    }
  }
  hub.subscribers.add(handler)
  return () => {
    hub.subscribers.delete(handler)
  }
}
