import type { BranchMap } from '$lib/message-tree'
import { createStableAnnotator, resolveAndAnnotate } from '$lib/message-tree'
import { conversationsStore } from '$lib/stores/conversations.svelte'
import { createOptimisticMap } from '$lib/stores/optimistic.svelte'
import { applyStreamOps } from '$lib/stream-ops'
import type { FileAttachment, ImageAttachment, StreamEvent, StreamOp, ThinkingEffort } from '$lib/types'
import type { ChatMessage } from '$lib/types/chat'
import { getContext, setContext } from 'svelte'

export type FetchStreamEvents = (messageId: string, from: number, to: number | null) => Promise<StreamEvent[]>

// Lazy so the store module stays importable without a PocketBase client env.
const defaultFetchStreamEvents: FetchStreamEvents = (messageId, from, to) => import('$lib/stream-events-client').then(m => m.fetchStreamEvents(messageId, from, to))

export type RequestFn = <T = unknown>(path: string, body: Record<string, unknown>) => Promise<T>

export interface ChatStoreDeps {
  request?: RequestFn
  notify?: (message: string) => void
  now?: () => Date
  id?: () => string
  fetchStreamEvents?: FetchStreamEvents
}

interface LiveState {
  lastSeq: number
  ops: Map<number, StreamOp[]>
  pendingGap: Promise<void> | null
}

interface QueueEntry {
  id: string
  conversationId: string
  content: string
  systemPrompt?: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
}

interface ChatResponse {
  userMessage?: ChatMessage
}

const ROOT_KEY = '__root__'

const defaultRequest: RequestFn = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string' ? data.message : 'Request failed'
    throw new Error(message)
  }
  return data as T
}

const CHAT_STORE_KEY = Symbol('chat-store')

export const setChatStore = (store: ChatStore) => setContext(CHAT_STORE_KEY, store)

export const getChatStore = (): ChatStore => {
  const store = getContext<ChatStore | undefined>(CHAT_STORE_KEY)
  if (!store) {
    throw new Error('ChatStore is only available inside the chat layout')
  }
  return store
}

export class ChatStore {
  private confirmed = $state<ChatMessage[]>([])
  private branches = $state<BranchMap>({})
  private conversationId = $state<string | null>(null)
  private pending = createOptimisticMap<ChatMessage>()
  private pendingBranchWrites = new Map<string, string>()
  private discardedIds = new Set<string>()

  // Live stream deltas per assistant message id, applied on top of the
  // confirmed snapshot (messages.eventSeq marks the folded prefix). State
  // objects and the map itself are replaced on every change so $derived
  // recomputes; appliedCache keeps object identity stable per message.
  private live = $state<Map<string, LiveState>>(new Map())
  private appliedCache = new Map<string, { snapshot: ChatMessage; lastSeq: number; result: ChatMessage }>()

  private queue = $state<QueueEntry[]>([])
  private awaiting = $state(false)
  private serverGenerating = $state(false)
  private activeConversationId: string | null = null
  private deps: Required<ChatStoreDeps>

  lastStreamActivity = $state(0)
  selectedModel = $state('')
  thinkingEffort = $state<ThinkingEffort>('none')

  constructor(deps: ChatStoreDeps = {}, initial?: { allMessages: ChatMessage[]; activeBranches: BranchMap }) {
    this.deps = {
      request: deps.request ?? defaultRequest,
      notify: deps.notify ?? (message => console.error('[chat]', message)),
      now: deps.now ?? (() => new Date()),
      id: deps.id ?? (() => crypto.randomUUID()),
      fetchStreamEvents: deps.fetchStreamEvents ?? defaultFetchStreamEvents,
    }
    if (initial) {
      this.confirmed = initial.allMessages
      this.branches = initial.activeBranches
      this.conversationId = initial.allMessages[0]?.conversationId ?? null
    }
    $effect.root(() => {
      let wasStreaming = false
      $effect(() => {
        const streaming = this.isStreaming
        if (wasStreaming && !streaming) {
          queueMicrotask(this.processQueue)
        }
        wasStreaming = streaming
      })
    })
  }

  private annotate = createStableAnnotator<ChatMessage>()

  private withLive = (m: ChatMessage): ChatMessage => {
    const state = this.live.get(m.id)
    if (!state) {
      return m
    }
    const eventSeq = m.eventSeq ?? 0
    if (state.lastSeq <= eventSeq) {
      return m
    }
    const cached = this.appliedCache.get(m.id)
    if (cached && cached.snapshot === m && cached.lastSeq === state.lastSeq) {
      return cached.result
    }
    const ops: StreamOp[] = []
    for (let s = eventSeq + 1; s <= state.lastSeq; ++s) {
      const batch = state.ops.get(s)
      if (batch) {
        ops.push(...batch)
      }
    }
    const result = applyStreamOps(m, ops)
    this.appliedCache.set(m.id, { snapshot: m, lastSeq: state.lastSeq, result })
    return result
  }

  allMessages = $derived<ChatMessage[]>([...this.confirmed.map(this.withLive), ...this.pending.values().filter(m => m.conversationId === this.conversationId && !this.confirmed.some(c => c.id === m.id))])

  messages = $derived(this.annotate(this.allMessages, this.branches))

  streamingMessage = $derived(this.allMessages.find(m => m.role === 'assistant' && m.generating))

  isStreaming = $derived(this.awaiting || this.serverGenerating || !!this.streamingMessage)

  get currentConversationId() {
    return this.conversationId
  }

  get activeBranches() {
    return this.branches
  }

  get awaitingGeneration() {
    return this.awaiting
  }

  get messageQueue() {
    return this.queue
  }

  set messageQueue(v: QueueEntry[]) {
    this.queue = v
  }

  private setBranchLocal = (parentKey: string, messageId: string) => {
    this.pendingBranchWrites.set(parentKey, messageId)
    this.branches = { ...this.branches, [parentKey]: messageId }
  }

  applyServerBranches = (branches: BranchMap) => {
    const merged = { ...branches }
    for (const [key, value] of this.pendingBranchWrites) {
      if (branches[key] === value) {
        this.pendingBranchWrites.delete(key)
      } else {
        merged[key] = value
      }
    }
    this.branches = merged
  }

  private mutateLive = (fn: (next: Map<string, LiveState>) => void) => {
    const next = new Map(this.live)
    fn(next)
    this.live = next
  }

  private confirmedEventSeq = (messageId: string): number => this.confirmed.find(m => m.id === messageId)?.eventSeq ?? 0

  private fillGap = async (messageId: string, from: number, to: number | null) => {
    try {
      const events = await this.deps.fetchStreamEvents(messageId, from, to)
      this.mutateLive(next => {
        const current = next.get(messageId) ?? { lastSeq: this.confirmedEventSeq(messageId), ops: new Map<number, StreamOp[]>(), pendingGap: null }
        const ops = new Map(current.ops)
        for (const e of events) {
          ops.set(e.seq, e.ops)
        }
        let lastSeq = current.lastSeq
        while (ops.has(lastSeq + 1)) {
          ++lastSeq
        }
        next.set(messageId, { ...current, ops, lastSeq })
      })
      this.lastStreamActivity = Date.now()
    } catch {}
  }

  ingestEvent = (e: StreamEvent) => {
    const confirmedMsg = this.confirmed.find(m => m.id === e.messageId)
    // A finalized message folds every event the drained writer produced; late
    // arrivals would double-apply.
    if (confirmedMsg && !confirmedMsg.generating) {
      return
    }
    const eventSeq = confirmedMsg?.eventSeq ?? 0
    if (e.seq <= eventSeq) {
      return
    }
    const existing = this.live.get(e.messageId)
    if (existing && (e.seq <= existing.lastSeq || existing.ops.has(e.seq))) {
      return
    }
    const base: LiveState = existing ?? { lastSeq: eventSeq, ops: new Map(), pendingGap: null }
    const ops = new Map(base.ops)
    ops.set(e.seq, e.ops)
    let pendingGap = base.pendingGap
    if (e.seq > base.lastSeq + 1 && !pendingGap) {
      pendingGap = this.fillGap(e.messageId, base.lastSeq + 1, e.seq - 1).finally(() => {
        this.mutateLive(next => {
          const current = next.get(e.messageId)
          if (current) {
            next.set(e.messageId, { ...current, pendingGap: null })
          }
        })
      })
    }
    let lastSeq = base.lastSeq
    while (ops.has(lastSeq + 1)) {
      ++lastSeq
    }
    this.mutateLive(next => next.set(e.messageId, { ...base, ops, lastSeq, pendingGap }))
    this.awaiting = false
    this.lastStreamActivity = Date.now()
  }

  fillMissingEvents = async (messageId: string) => {
    const state = this.live.get(messageId)
    if (state?.pendingGap) {
      await state.pendingGap
      return
    }
    const from = Math.max(state?.lastSeq ?? 0, this.confirmedEventSeq(messageId)) + 1
    await this.fillGap(messageId, from, null)
  }

  private getLastMessageId = (): string | null => {
    const resolved = resolveAndAnnotate(this.allMessages, this.branches)
    return resolved.length > 0 ? resolved[resolved.length - 1].id : null
  }

  private markSendFailed = (messageId: string, err: unknown) => {
    this.awaiting = false
    const sendError = err instanceof Error ? err.message : 'Failed to send message'
    this.pending.patch(messageId, { sendError })
    if (!this.pending.has(messageId)) {
      this.confirmed = this.confirmed.map(m => (m.id === messageId ? { ...m, sendError } : m))
    }
    this.queue = []
  }

  private triggerGeneration = (conversationId: string, message: string, parentId: string | null, userMsgId: string, skipUserInsert: boolean, systemPrompt?: string, images?: ImageAttachment[], files?: FileAttachment[]) =>
    this.deps.request<ChatResponse>('/api/chat', {
      conversationId,
      model: this.selectedModel,
      message,
      images: images?.length ? images : undefined,
      files: files?.length ? files : undefined,
      systemPrompt,
      thinkingEffort: this.thinkingEffort,
      parentId,
      userMsgId,
      skipUserInsert,
    })

  private reconcileUserMessage = (msg: ChatMessage | undefined) => {
    if (!msg) {
      return
    }
    this.upsertMessage({
      ...msg,
      createdAt: new Date(msg.createdAt),
      settledAt: msg.settledAt ? new Date(msg.settledAt) : undefined,
    })
  }

  private fetchTitle = async (conversationId: string) => {
    try {
      const data = await this.deps.request<{ title?: string }>('/api/chat/title', { conversationId })
      if (data.title) {
        conversationsStore.applyTitle(conversationId, data.title)
      }
    } catch (err) {
      this.deps.notify(err instanceof Error ? err.message : 'Failed to generate title')
    }
  }

  sendMessage = async (conversationId: string, content: string, systemPrompt?: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
    if (this.isStreaming) {
      this.queue = [...this.queue, { id: this.deps.id(), conversationId, content, systemPrompt, images, files }]
      return
    }

    this.activeConversationId = conversationId
    this.conversationId = conversationId
    const isFirstMessage = this.allMessages.length === 0
    const parentId = this.getLastMessageId()

    const userMsg: ChatMessage = {
      id: this.deps.id(),
      conversationId,
      parentId,
      role: 'user',
      content,
      images: images?.length ? images : undefined,
      files: files?.length ? files : undefined,
      createdAt: this.deps.now(),
    }
    this.pending.add(userMsg)
    this.setBranchLocal(userMsg.parentId ?? ROOT_KEY, userMsg.id)
    this.awaiting = true

    try {
      const data = await this.triggerGeneration(conversationId, content, parentId, userMsg.id, false, systemPrompt, images, files)
      this.reconcileUserMessage(data.userMessage)
      if (isFirstMessage) {
        void this.fetchTitle(conversationId)
      }
    } catch (err) {
      this.markSendFailed(userMsg.id, err)
    }
  }

  regenerateMessage = async (conversationId: string, messageId: string) => {
    if (this.isStreaming) {
      return
    }

    this.activeConversationId = conversationId
    this.awaiting = true
    try {
      await this.deps.request('/api/chat/regenerate', { conversationId, messageId, model: this.selectedModel, thinkingEffort: this.thinkingEffort })
    } catch (err) {
      this.awaiting = false
      throw err
    }
  }

  editMessage = async (conversationId: string, messageId: string, newContent: string) => {
    if (this.isStreaming) {
      return
    }

    const targetMsg = this.allMessages.find(m => m.id === messageId)
    if (targetMsg?.role !== 'user') {
      return
    }

    this.activeConversationId = conversationId
    const newUserMsg: ChatMessage = {
      id: this.deps.id(),
      conversationId,
      parentId: targetMsg.parentId ?? null,
      role: 'user',
      content: newContent,
      images: targetMsg.images,
      files: targetMsg.files,
      createdAt: this.deps.now(),
    }
    this.pending.add(newUserMsg)
    this.setBranchLocal(newUserMsg.parentId ?? ROOT_KEY, newUserMsg.id)
    this.awaiting = true

    try {
      await this.deps.request('/api/chat/edit', { conversationId, messageId, content: newContent, newMessageId: newUserMsg.id })
      const data = await this.triggerGeneration(conversationId, newContent, newUserMsg.parentId ?? null, newUserMsg.id, true, undefined, targetMsg.images, targetMsg.files)
      this.reconcileUserMessage(data.userMessage)
    } catch (err) {
      this.markSendFailed(newUserMsg.id, err)
    }
  }

  retryFailedMessage = async (conversationId: string, messageId: string) => {
    if (this.isStreaming) {
      return
    }

    const target = this.allMessages.find(m => m.id === messageId)
    if (target?.role !== 'user' || !target.sendError) {
      return
    }

    this.activeConversationId = conversationId
    this.awaiting = true
    this.pending.patch(messageId, { sendError: undefined })
    if (!this.pending.has(messageId)) {
      this.confirmed = this.confirmed.map(m => (m.id === messageId ? { ...m, sendError: undefined } : m))
    }

    try {
      const data = await this.triggerGeneration(conversationId, target.content, target.parentId ?? null, messageId, !this.pending.has(messageId), undefined, target.images, target.files)
      this.reconcileUserMessage(data.userMessage)
    } catch (err) {
      this.markSendFailed(messageId, err)
      return
    }

    if (this.queue.length > 0) {
      this.processQueue()
    }
  }

  discardFailedMessage = (messageId: string) => {
    this.discardedIds.add(messageId)
    this.pending.remove(messageId)
    this.confirmed = this.confirmed.filter(m => m.id !== messageId)
    const nextBranches: BranchMap = {}
    for (const [key, value] of Object.entries(this.branches)) {
      if (value !== messageId) {
        nextBranches[key] = value
      }
    }
    this.branches = nextBranches
    void this.deps.request('/api/chat/discard', { messageId }).catch(() => {})
  }

  switchBranch = async (conversationId: string, parentKey: string, targetMessageId: string) => {
    this.setBranchLocal(parentKey, targetMessageId)
    await this.deps.request('/api/chat/branch', { conversationId, parentKey, selectedChildId: targetMessageId })
  }

  stopStreaming = () => {
    this.queue = []
    this.awaiting = false
    // Optimistic: unfreeze the UI immediately, the server snapshot confirms.
    const streaming = this.streamingMessage
    if (streaming) {
      this.mutateLive(next => next.delete(streaming.id))
      this.appliedCache.delete(streaming.id)
      this.confirmed = this.confirmed.map(m => (m.id === streaming.id ? { ...m, generating: false } : m))
    }
    const convId = this.activeConversationId ?? this.conversationId
    if (convId) {
      this.deps
        .request('/api/chat/stop', { conversationId: convId })
        .then(() => (streaming ? this.fillMissingEvents(streaming.id) : undefined))
        .catch(err => this.deps.notify(err instanceof Error ? err.message : 'Failed to stop generation'))
    }
  }

  processQueue = () => {
    if (this.isStreaming || this.queue.length === 0) {
      return
    }
    const [next, ...rest] = this.queue
    this.queue = rest
    void this.sendMessage(next.conversationId, next.content, next.systemPrompt, next.images, next.files)
  }

  editQueuedMessage = (id: string, content: string) => {
    this.queue = this.queue.map(m => (m.id === id ? { ...m, content } : m))
  }

  deleteQueuedMessage = (id: string) => {
    this.queue = this.queue.filter(m => m.id !== id)
  }

  upsertMessage = (msg: ChatMessage) => {
    if (this.discardedIds.has(msg.id)) {
      return
    }
    if (msg.generating) {
      this.awaiting = false
      this.lastStreamActivity = Date.now()
    }
    const inheritedError = (this.confirmed.find(m => m.id === msg.id) ?? this.pending.get(msg.id))?.sendError
    this.pending.confirm(msg.id)
    const existing = this.confirmed.find(m => m.id === msg.id)
    const merged = inheritedError && !msg.sendError ? { ...msg, sendError: inheritedError } : msg
    this.confirmed = existing ? this.confirmed.map(m => (m.id === msg.id ? merged : m)) : [...this.confirmed, merged]
    const state = this.live.get(msg.id)
    if (state) {
      if (!msg.generating) {
        this.mutateLive(next => next.delete(msg.id))
        this.appliedCache.delete(msg.id)
      } else {
        // Drop ops the snapshot folded, keep anything buffered beyond it.
        const eventSeq = msg.eventSeq ?? 0
        const ops = new Map<number, StreamOp[]>()
        for (const [seq, batch] of state.ops) {
          if (seq > eventSeq) {
            ops.set(seq, batch)
          }
        }
        let lastSeq = eventSeq
        while (ops.has(lastSeq + 1)) {
          ++lastSeq
        }
        if (ops.size === 0 && !state.pendingGap) {
          this.mutateLive(next => next.delete(msg.id))
          this.appliedCache.delete(msg.id)
        } else {
          this.mutateLive(next => next.set(msg.id, { ...state, ops, lastSeq }))
        }
      }
    }
  }

  removeMessage = (id: string) => {
    this.pending.remove(id)
    this.confirmed = this.confirmed.filter(m => m.id !== id)
  }

  seed = (conversationId: string, allMsgs: ChatMessage[], branches: BranchMap) => {
    if (conversationId !== this.conversationId) {
      this.conversationId = conversationId
      this.awaiting = false
      this.serverGenerating = false
    }
    this.live = new Map()
    this.appliedCache.clear()
    this.confirmed = allMsgs
    this.pendingBranchWrites.clear()
    this.branches = branches
  }

  setConversationGenerating = (generating: boolean) => {
    this.serverGenerating = generating
    if (generating) {
      this.awaiting = false
    }
  }
}
