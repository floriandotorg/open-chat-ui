import type { ChatStore } from '$lib/stores/chat.svelte'
import type { StreamEvent } from '$lib/types'
import type { ChatMessage, ConversationDetail, ConversationSummary } from '$lib/types/chat'
import { isHttpError } from '@sveltejs/kit'
import { untrack } from 'svelte'

export type { ConversationDetail } from '$lib/types/chat'

export type FetchDetail = (id: string, fetchFn?: typeof fetch) => Promise<ConversationDetail>

export interface ChatStoresDeps {
  fetchDetail: FetchDetail
  createStore: (conversationId: string) => ChatStore
  currentId: () => string | undefined
  capacity?: number
}

interface Entry {
  store: ChatStore
  stale: boolean
}

type Replay = (store: ChatStore) => void

// One ChatStore per visited conversation, kept alive across navigation and
// fed by app-wide realtime routing. Stores are handed out synchronously, so
// navigation never waits for the network: a store that is still loading
// renders its skeleton and fills in when the detail arrives.
export class ChatStores {
  private entries = new Map<string, Entry>()
  private inflight = new Map<string, Promise<void>>()
  private replays = new Map<string, Replay[]>()
  private deps: Required<ChatStoresDeps>

  constructor(deps: ChatStoresDeps) {
    this.deps = { ...deps, capacity: deps.capacity ?? 30 }
  }

  peek = (id: string): ChatStore | undefined => this.entries.get(id)?.store

  require = (id: string): ChatStore => {
    const store = this.peek(id)
    if (!store) {
      throw new Error(`Conversation ${id} is not loaded`)
    }
    return store
  }

  ensure = (id: string, fetchFn?: typeof fetch): ChatStore =>
    untrack(() => {
      const entry = this.entries.get(id)
      if (entry) {
        this.touch(id, entry)
        if (entry.stale || entry.store.status === 'error') {
          void this.load(id, fetchFn)
        }
        return entry.store
      }
      const store = this.createStore(id)
      store.status = 'loading'
      this.touch(id, { store, stale: false })
      this.evict(id)
      void this.load(id, fetchFn)
      return store
    })

  whenLoaded = (id: string): Promise<void> => this.inflight.get(id) ?? Promise.resolve()

  prefetch = (ids: string[]) => {
    for (const id of ids) {
      if (!this.entries.has(id)) {
        this.ensure(id)
      }
    }
  }

  revalidate = (id: string): Promise<void> => (this.entries.has(id) ? this.load(id) : Promise.resolve())

  createEmpty = (conversation: ConversationSummary): ChatStore =>
    untrack(() => {
      const store = this.createStore(conversation.id)
      store.pendingCreation = conversation
      this.touch(conversation.id, { store, stale: false })
      this.evict(conversation.id)
      return store
    })

  markStale = () => {
    for (const entry of this.entries.values()) {
      entry.stale = true
    }
    const current = this.deps.currentId()
    if (current) {
      void this.revalidate(current)
    }
  }

  routeMessage = (msg: ChatMessage) => this.route(msg.conversationId, store => store.upsertMessage(msg))

  removeMessage = (conversationId: string, messageId: string) => this.route(conversationId, store => store.removeMessage(messageId))

  routeEvent = (conversationId: string, event: StreamEvent) => this.route(conversationId, store => store.ingestEvent(event))

  // Updates that race an in-flight fetch are replayed on top of its snapshot;
  // eventSeq and seq checks in ChatStore drop whatever the snapshot covers.
  private route = (conversationId: string, apply: Replay) => {
    this.replays.get(conversationId)?.push(apply)
    const store = this.peek(conversationId)
    if (store) {
      apply(store)
    }
  }

  private load = (id: string, fetchFn?: typeof fetch): Promise<void> => {
    const existing = this.inflight.get(id)
    if (existing) {
      return existing
    }
    const replays: Replay[] = []
    this.replays.set(id, replays)
    const promise = this.deps
      .fetchDetail(id, fetchFn)
      .then(detail => this.seed(id, detail, replays))
      .catch(err => this.fail(id, err))
      .finally(() => {
        this.inflight.delete(id)
        this.replays.delete(id)
      })
    this.inflight.set(id, promise)
    return promise
  }

  private seed = (id: string, detail: ConversationDetail, replays: Replay[]) => {
    const entry = this.entries.get(id)
    if (!entry) {
      return
    }
    entry.store.seed(detail)
    entry.stale = false
    for (const replay of replays) {
      replay(entry.store)
    }
    void entry.store.catchUpStreams()
  }

  private fail = (id: string, err: unknown) => {
    const store = this.peek(id)
    if (!store) {
      return
    }
    if (isHttpError(err, 404)) {
      store.status = 'missing'
    } else if (store.status === 'loading') {
      store.status = 'error'
    }
  }

  // Stores outlive whatever component triggered their creation; deriveds
  // created under a component effect would go inert once it is destroyed.
  private createStore = (id: string): ChatStore => {
    let store: ChatStore | undefined
    $effect.root(() => {
      store = this.deps.createStore(id)
    })
    if (!store) {
      throw new Error(`Failed to create the store for ${id}`)
    }
    return store
  }

  private touch = (id: string, entry: Entry) => {
    this.entries.delete(id)
    this.entries.set(id, entry)
  }

  private evict = (keepId: string) => {
    const current = this.deps.currentId()
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.deps.capacity) {
        return
      }
      if (id !== keepId && id !== current && !entry.store.isStreaming) {
        entry.store.dispose()
        this.entries.delete(id)
      }
    }
  }
}
