import type { Conversation } from '$lib/db-mappers'
import { mapConversation } from '$lib/db-mappers'
import { pbClient } from '$lib/pb-client'
import { browser } from '$app/environment'

export const createConversationsStore = (initial: Conversation[]) => {
  let byId = $state<Map<string, Conversation>>(new Map(initial.map(c => [c.id, c])))

  const conversations = $derived([...byId.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()))

  const upsert = (c: Conversation) => {
    const next = new Map(byId)
    next.set(c.id, c)
    byId = next
  }
  const remove = (id: string) => {
    const next = new Map(byId)
    next.delete(id)
    byId = next
  }
  const seed = (list: Conversation[]) => {
    byId = new Map(list.map(c => [c.id, c]))
  }

  let unsub: (() => void) | null = null
  let cancelled = false
  const subscribe = async () => {
    if (!browser || unsub) return
    cancelled = false
    try {
      const u = await pbClient.collection('conversations').subscribe('*', e => {
        if (e.action === 'delete') remove(e.record.id)
        else upsert(mapConversation(e.record))
      })
      if (cancelled) {
        u()
        return
      }
      unsub = u
    } catch (err) {
      console.warn('[realtime] conversations subscribe failed', err)
    }
  }
  const unsubscribe = () => {
    cancelled = true
    unsub?.()
    unsub = null
  }

  return {
    get conversations() {
      return conversations
    },
    upsert,
    remove,
    seed,
    subscribe,
    unsubscribe,
  }
}
