import { fetchConversationDetail } from '$lib/conversation-detail'
import { mapChatMessage } from '$lib/db-mappers'
import { pbClient } from '$lib/pb-client'
import { createRealtimeSlot, isRealtimeLive, noteRealtimeActivity, registerRealtime } from '$lib/realtime-watchdog'
import { ChatStore, type QueueEntry } from '$lib/stores/chat.svelte'
import { ChatStores } from '$lib/stores/chat-stores.svelte'
import { invalidatePayload } from '$lib/stores/payloads.svelte'
import { fetchMessage, fetchStreamEvents } from '$lib/stream-events-client'
import { browser } from '$app/environment'
import { page } from '$app/state'

const queueKey = (conversationId: string) => `chat-queue-${conversationId}`

const readQueue = (conversationId: string): QueueEntry[] => {
  const parsed = JSON.parse(localStorage.getItem(queueKey(conversationId)) ?? 'null')
  return Array.isArray(parsed) ? parsed : []
}

const writeQueue = (conversationId: string, queue: QueueEntry[]) => {
  if (queue.length > 0) {
    localStorage.setItem(queueKey(conversationId), JSON.stringify(queue))
  } else {
    localStorage.removeItem(queueKey(conversationId))
  }
}

const createPersistentStore = (conversationId: string) => {
  const store = new ChatStore(conversationId, { fetchStreamEvents, fetchMessage, realtimeLive: isRealtimeLive, persistQueue: queue => writeQueue(conversationId, queue) })
  store.messageQueue = readQueue(conversationId)
  return store
}

let instance: ChatStores | null = null
let chatMounted = false

// False only while the first page hydrates, which must render exactly what
// the server rendered.
export const isChatMounted = () => chatMounted

export const markChatMounted = () => {
  chatMounted = true
}

export const getChatStores = (): ChatStores => {
  if (!browser) {
    throw new Error('ChatStores live in the browser only')
  }
  instance ??= new ChatStores({
    fetchDetail: fetchConversationDetail,
    createStore: createPersistentStore,
    currentId: () => page.params.conversationId,
  })
  return instance
}

// App-wide subscriptions keep every cached conversation current, including
// the ones not on screen, so switching back never needs a refetch.
export const attachChatRealtime = (): (() => void) => {
  const stores = getChatStores()
  const messagesSlot = createRealtimeSlot(() =>
    pbClient.collection('messages').subscribe('*', e => {
      noteRealtimeActivity()
      if (e.action === 'delete') {
        stores.removeMessage(e.record.conversation, e.record.id)
        return
      }
      const msg = mapChatMessage(e.record)
      // The payload is written right before the final message update.
      if (!msg.generating) {
        invalidatePayload(msg.id)
      }
      stores.routeMessage(msg)
    }),
  )
  const eventsSlot = createRealtimeSlot(() =>
    pbClient.collection('stream_events').subscribe('*', e => {
      noteRealtimeActivity()
      if (e.action === 'create') {
        stores.routeEvent(e.record.conversation, { messageId: e.record.message, seq: e.record.seq, ops: Array.isArray(e.record.ops) ? e.record.ops : [] })
      }
    }),
  )
  void messagesSlot.subscribe()
  void eventsSlot.subscribe()
  const deregister = registerRealtime({
    subscribe: async () => {
      await Promise.all([messagesSlot.subscribe(), eventsSlot.subscribe()])
    },
    unsubscribe: () => {
      messagesSlot.unsubscribe()
      eventsSlot.unsubscribe()
    },
    isHealthy: () => messagesSlot.isHealthy() && eventsSlot.isHealthy(),
    resync: stores.markStale,
  })
  return () => {
    deregister()
    messagesSlot.cancel()
    eventsSlot.cancel()
  }
}
