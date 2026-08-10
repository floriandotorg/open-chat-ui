import type { Conversation } from '$lib/db-mappers'
import { mapConversation } from '$lib/db-mappers'
import { pbClient } from '$lib/pb-client'
import { createOptimisticMap } from '$lib/stores/optimistic.svelte'
import { browser } from '$app/environment'

export const createConversationsStore = (initial: Conversation[]) => {
  let byId = $state<Map<string, Conversation>>(new Map(initial.map(c => [c.id, c])))
  const pending = createOptimisticMap<Conversation>()
  const pendingPatches = new Map<string, Partial<Conversation>>()

  const conversations = $derived([...byId.values(), ...pending.values().filter(c => !byId.has(c.id))].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()))

  const upsert = (c: Conversation) => {
    if (!byId.has(c.id) && !pending.has(c.id) && byId.size >= 100) return
    pending.confirm(c.id)
    const patch = pendingPatches.get(c.id)
    let merged = c
    if (patch) {
      const leftover: Partial<Conversation> = {}
      merged = { ...c }
      for (const [key, value] of Object.entries(patch) as [keyof Conversation, unknown][]) {
        if (JSON.stringify(c[key]) === JSON.stringify(value)) {
          pendingPatches.delete(c.id)
        } else {
          Object.assign(merged, { [key]: value })
          Object.assign(leftover, { [key]: value })
        }
      }
      if (Object.keys(leftover).length) pendingPatches.set(c.id, leftover)
    }
    const next = new Map(byId)
    next.set(c.id, merged)
    byId = next
  }
  const remove = (id: string) => {
    pending.remove(id)
    pendingPatches.delete(id)
    const next = new Map(byId)
    next.delete(id)
    byId = next
  }
  const seed = (list: Conversation[]) => {
    byId = new Map(list.map(c => [c.id, c]))
  }
  const addPending = (c: Conversation) => {
    pending.add(c)
  }
  const patch = (id: string, partial: Partial<Conversation>) => {
    const current = byId.get(id)
    if (!current) return
    pendingPatches.set(id, { ...pendingPatches.get(id), ...partial })
    const next = new Map(byId)
    next.set(id, { ...current, ...partial })
    byId = next
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

  const resync = async () => {
    if (!browser || cancelled) return
    const userId = pbClient.authStore.record?.id
    if (!userId) return
    try {
      const rows = await pbClient.collection('conversations').getFullList({
        filter: pbClient.filter('user = {:u}', { u: userId }),
        sort: '-updatedAt',
      })
      if (!cancelled) {
        seed(
          rows.map(mapConversation).map(c => {
            const patch = pendingPatches.get(c.id)
            return patch ? { ...c, ...patch } : c
          }),
        )
      }
    } catch (err) {
      console.warn('[realtime] conversations resync failed', err)
    }
  }

  return {
    get conversations() {
      return conversations
    },
    upsert,
    remove,
    seed,
    addPending,
    patch,
    subscribe,
    unsubscribe,
    resync,
  }
}
