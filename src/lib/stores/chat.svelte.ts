import type { BranchMap } from '$lib/message-tree'
import { createStableAnnotator, resolveAndAnnotate } from '$lib/message-tree'
import { applyStreamOps } from '$lib/stream-ops'
import { api } from '$lib/sync/api'
import { Mutation, mutate, SyncCollection, type Write } from '$lib/sync/collection.svelte'
import { type ConversationStateRecord, type ConversationsCollection, conversationStates, conversations } from '$lib/sync/conversations.svelte'
import { errorMessage } from '$lib/sync/errors'
import type { FileAttachment, ImageAttachment, StreamEvent, StreamOp, ThinkingEffort } from '$lib/types'
import type { ChatMessage, ConversationDetail, ConversationSummary } from '$lib/types/chat'

export type FetchStreamEvents = (messageId: string, from: number, to: number | null) => Promise<StreamEvent[]>
export type FetchMessage = (messageId: string) => Promise<ChatMessage | null>
export type RequestFn = <T = unknown>(path: string, body: Record<string, unknown>) => Promise<T>

// Lazy so the store module stays importable without a PocketBase client env.
const defaultFetchStreamEvents: FetchStreamEvents = (messageId, from, to) => import('$lib/stream-events-client').then(m => m.fetchStreamEvents(messageId, from, to))
const defaultFetchMessage: FetchMessage = messageId => import('$lib/stream-events-client').then(m => m.fetchMessage(messageId))

export interface ChatStoreDeps {
  request?: RequestFn
  notify?: (message: string) => void
  now?: () => Date
  id?: () => string
  fetchStreamEvents?: FetchStreamEvents
  fetchMessage?: FetchMessage
  realtimeLive?: () => boolean
  persistQueue?: (queue: QueueEntry[]) => void
  conversations?: ConversationsCollection
  conversationStates?: SyncCollection<ConversationStateRecord>
}

interface LiveState {
  lastSeq: number
  ops: Map<number, StreamOp[]>
  pendingGap: Promise<void> | null
}

export interface QueueEntry {
  id: string
  content: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
}

export type ChatStoreStatus = 'loading' | 'ready' | 'missing' | 'error'

interface GenerateBody {
  message: string
  parentId: string | null
  userMsgId: string
  skipUserInsert: boolean
  images?: ImageAttachment[]
  files?: FileAttachment[]
}

const ROOT_KEY = '__root__'
// While realtime delivers, polling only covers quiet stretches (thinking,
// tool rounds). Once it is known to lag, the REST path carries the stream.
const LIVE_FOLLOW_MS = 2_500
const DEGRADED_FOLLOW_MS = 250
const FOLLOW_TICK_MS = 150

const isSeqAhead = (incoming: ChatMessage, current: ChatMessage) => (incoming.eventSeq ?? 0) >= (current.eventSeq ?? 0)

const withBranch =
  (key: string, messageId: string) =>
  (state: ConversationStateRecord): ConversationStateRecord => ({ ...state, activeBranches: { ...state.activeBranches, [key]: messageId } })

const withoutBranchTo =
  (messageId: string) =>
  (state: ConversationStateRecord): ConversationStateRecord => ({ ...state, activeBranches: Object.fromEntries(Object.entries(state.activeBranches).filter(([, value]) => value !== messageId)) })

export class ChatStore {
  readonly records = new SyncCollection<ChatMessage>({ accept: isSeqAhead })
  status = $state<ChatStoreStatus>('ready')
  selectedModel = $state('')
  thinkingEffort = $state<ThinkingEffort>('none')
  // The local conversation record, created on the server by the first send.
  pendingCreation: ConversationSummary | null = null
  private lastStreamActivity = 0

  // Live stream deltas per assistant message id, applied on top of the
  // snapshot (messages.eventSeq marks the folded prefix). The map is replaced
  // on every change so deriveds recompute; appliedCache keeps object identity
  // stable per message.
  private live = $state.raw(new Map<string, LiveState>())
  private appliedCache = new Map<string, { snapshot: ChatMessage; lastSeq: number; result: ChatMessage }>()
  private queue = $state<QueueEntry[]>([])
  private discardedIds = new Set<string>()
  private deps: Required<Omit<ChatStoreDeps, 'persistQueue'>>
  private disposeEffects: () => void
  private lastFollowAt = 0
  private following = false
  private realtimeLagging = false

  constructor(
    readonly conversationId: string,
    deps: ChatStoreDeps = {},
  ) {
    this.deps = {
      request: deps.request ?? api.post,
      notify: deps.notify ?? (message => console.error('[chat]', message)),
      now: deps.now ?? (() => new Date()),
      id: deps.id ?? (() => crypto.randomUUID()),
      fetchStreamEvents: deps.fetchStreamEvents ?? defaultFetchStreamEvents,
      fetchMessage: deps.fetchMessage ?? defaultFetchMessage,
      realtimeLive: deps.realtimeLive ?? (() => true),
      conversations: deps.conversations ?? conversations,
      conversationStates: deps.conversationStates ?? conversationStates,
    }
    const { persistQueue } = deps
    this.disposeEffects = $effect.root(() => {
      $effect(() => {
        if (!this.isStreaming && this.status === 'ready' && this.queue.length > 0) {
          queueMicrotask(this.processQueue)
        }
      })
      $effect(() => {
        if (!this.streamingId) {
          return
        }
        this.realtimeLagging = false
        const timer = setInterval(() => void this.follow(), FOLLOW_TICK_MS)
        return () => clearInterval(timer)
      })
      if (persistQueue) {
        $effect(() => persistQueue(this.queue))
      }
    })
  }

  dispose = () => this.disposeEffects()

  private annotate = createStableAnnotator<ChatMessage>()

  private get state() {
    return this.deps.conversationStates.get(this.conversationId)
  }

  activeBranches = $derived<BranchMap>(this.state?.activeBranches ?? {})

  private serverGenerating = $derived(this.state?.generating ?? false)

  allMessages = $derived<ChatMessage[]>(this.records.list.map(m => this.decorate(m)))

  messages = $derived(this.annotate(this.allMessages, this.activeBranches))

  streamingMessage = $derived(this.allMessages.find(m => m.role === 'assistant' && m.generating))

  private streamingId = $derived(this.streamingMessage?.id ?? null)

  isStreaming = $derived(this.serverGenerating || !!this.streamingMessage)

  get messageQueue() {
    return this.queue
  }

  set messageQueue(v: QueueEntry[]) {
    this.queue = v
  }

  private decorate = (m: ChatMessage): ChatMessage => {
    const withLive = this.withLive(m)
    const failure = this.records.failure(m.id)
    return failure?.error ? { ...withLive, sendError: failure.error } : withLive
  }

  private withLive = (m: ChatMessage): ChatMessage => {
    const state = this.live.get(m.id)
    const eventSeq = m.eventSeq ?? 0
    if (!state || state.lastSeq <= eventSeq) {
      return m
    }
    const cached = this.appliedCache.get(m.id)
    if (cached && cached.snapshot === m && cached.lastSeq === state.lastSeq) {
      return cached.result
    }
    const ops: StreamOp[] = []
    for (let seq = eventSeq + 1; seq <= state.lastSeq; ++seq) {
      const batch = state.ops.get(seq)
      if (batch) {
        ops.push(...batch)
      }
    }
    const result = applyStreamOps(m, ops)
    this.appliedCache.set(m.id, { snapshot: m, lastSeq: state.lastSeq, result })
    return result
  }

  private mutateLive = (fn: (next: Map<string, LiveState>) => void) => {
    const next = new Map(this.live)
    fn(next)
    this.live = next
  }

  private dropLive = (messageId: string) => {
    if (this.live.has(messageId)) {
      this.mutateLive(next => next.delete(messageId))
    }
    this.appliedCache.delete(messageId)
  }

  private confirmedEventSeq = (messageId: string): number => this.records.confirmed(messageId)?.eventSeq ?? 0

  private fillGap = async (messageId: string, from: number, to: number | null): Promise<number> => {
    try {
      const events = await this.deps.fetchStreamEvents(messageId, from, to)
      if (events.length === 0) {
        return 0
      }
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
      return events.length
    } catch {
      return 0
    }
  }

  ingestEvent = (e: StreamEvent) => {
    const confirmed = this.records.confirmed(e.messageId)
    // A finalized message folds every event the drained writer produced; late
    // arrivals would double-apply.
    if (confirmed && !confirmed.generating) {
      return
    }
    const eventSeq = confirmed?.eventSeq ?? 0
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
      pendingGap = this.fillGap(e.messageId, base.lastSeq + 1, e.seq - 1).then(() => {
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
    this.lastStreamActivity = Date.now()
  }

  fillMissingEvents = async (messageId: string): Promise<number> => {
    const state = this.live.get(messageId)
    if (state?.pendingGap) {
      await state.pendingGap
      return 0
    }
    const from = Math.max(state?.lastSeq ?? 0, this.confirmedEventSeq(messageId)) + 1
    return this.fillGap(messageId, from, null)
  }

  catchUpStreams = async () => {
    for (const m of this.allMessages) {
      if (m.generating && m.role === 'assistant') {
        await this.fillMissingEvents(m.id)
      }
    }
  }

  // Converges the streaming message over plain HTTP whenever realtime stays
  // quiet, so a buffered or dead SSE channel degrades to polling instead of
  // freezing the answer.
  private follow = async () => {
    const messageId = this.streamingId
    if (!messageId || this.following || this.records.isPending(messageId)) {
      return
    }
    const interval = this.realtimeLagging || !this.deps.realtimeLive() ? DEGRADED_FOLLOW_MS : LIVE_FOLLOW_MS
    if (Date.now() - Math.max(this.lastStreamActivity, this.lastFollowAt) < interval) {
      return
    }
    this.following = true
    this.lastFollowAt = Date.now()
    try {
      const [fetched] = await Promise.all([this.refreshMessage(messageId), this.fillMissingEvents(messageId)])
      if (fetched > 0) {
        this.realtimeLagging = true
      }
    } finally {
      this.following = false
    }
  }

  private refreshMessage = async (messageId: string): Promise<number> => {
    try {
      const record = await this.deps.fetchMessage(messageId)
      if (record) {
        const before = this.records.confirmed(messageId)
        this.upsertMessage(record)
        return before && (record.eventSeq ?? 0) === (before.eventSeq ?? 0) && record.generating === before.generating ? 0 : 1
      }
      // Generation failed on the server: the placeholder is gone and the
      // error sits on the triggering user message.
      const parentId = this.records.confirmed(messageId)?.parentId
      this.removeMessage(messageId)
      this.deps.conversationStates.merge(this.conversationId, { generating: false })
      if (parentId) {
        await this.refreshMessage(parentId)
      }
      return 1
    } catch {
      return 0
    }
  }

  private lastMessageId = (): string | null => resolveAndAnnotate(this.allMessages, this.activeBranches).at(-1)?.id ?? null

  private userMessage = (parentId: string | null, content: string, images?: ImageAttachment[], files?: FileAttachment[]): ChatMessage => ({
    id: this.deps.id(),
    conversationId: this.conversationId,
    parentId,
    role: 'user',
    content,
    images: images?.length ? images : undefined,
    files: files?.length ? files : undefined,
    createdAt: this.deps.now(),
  })

  private placeholder = (parentId: string): ChatMessage => ({
    id: this.deps.id(),
    conversationId: this.conversationId,
    parentId,
    role: 'assistant',
    content: '',
    model: this.selectedModel || null,
    generating: true,
    createdAt: new Date(this.deps.now().getTime() + 1),
  })

  private branchWrite = (key: string, messageId: string): Write => this.deps.conversationStates.update(this.conversationId, withBranch(key, messageId))

  private userWrites = (message: ChatMessage): Write[] => {
    const creation = this.pendingCreation
    const writes: Write[] = creation ? [this.deps.conversations.put(creation), this.deps.conversationStates.put({ id: this.conversationId, generating: false, activeBranches: {} })] : [this.deps.conversations.patch(this.conversationId, { updatedAt: message.createdAt })]
    return [...writes, this.records.put(message), this.branchWrite(message.parentId ?? ROOT_KEY, message.id)]
  }

  // The user message and the assistant placeholder render before the request
  // leaves; a failed send keeps the user message (with Retry) and drops the
  // placeholder.
  private generate = async (userMutation: Mutation, body: GenerateBody): Promise<boolean> => {
    const assistant = this.placeholder(body.userMsgId)
    const assistantMutation = new Mutation([this.records.put(assistant), this.branchWrite(body.userMsgId, assistant.id), this.deps.conversationStates.patch(this.conversationId, { generating: true })], { silent: true })
    const creation = this.pendingCreation
    const response = this.deps.request<{ userMessage?: ChatMessage }>('/api/chat', {
      conversationId: this.conversationId,
      model: this.selectedModel,
      thinkingEffort: this.thinkingEffort,
      ...body,
      images: body.images?.length ? body.images : undefined,
      files: body.files?.length ? body.files : undefined,
      assistantMsgId: assistant.id,
      createConversation: creation ? { systemPromptId: creation.systemPromptId } : undefined,
    })
    await Promise.all([userMutation.run(() => response), assistantMutation.run(() => response)])
    if (userMutation.status !== 'settled') {
      this.queue = []
      return false
    }
    this.pendingCreation = null
    const { userMessage } = await response
    if (userMessage) {
      this.upsertMessage({ ...userMessage, createdAt: new Date(userMessage.createdAt), settledAt: userMessage.settledAt ? new Date(userMessage.settledAt) : undefined })
    }
    return true
  }

  private fetchTitle = async () => {
    try {
      const data = await this.deps.request<{ title?: string }>('/api/chat/title', { conversationId: this.conversationId })
      if (data.title) {
        this.deps.conversations.merge(this.conversationId, { title: data.title })
      }
    } catch (err) {
      this.deps.notify(errorMessage(err, 'Failed to generate title'))
    }
  }

  sendMessage = async (content: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
    if (this.isStreaming || this.status !== 'ready') {
      this.queue = [...this.queue, { id: this.deps.id(), content, images, files }]
      return
    }
    const isFirstMessage = this.allMessages.length === 0
    const message = this.userMessage(this.lastMessageId(), content, images, files)
    const sent = await this.generate(new Mutation(this.userWrites(message), { keepOnError: true }), { message: content, parentId: message.parentId ?? null, userMsgId: message.id, skipUserInsert: false, images, files })
    if (sent && isFirstMessage) {
      void this.fetchTitle()
    }
  }

  regenerateMessage = async (messageId: string) => {
    const target = this.allMessages.find(m => m.id === messageId)
    if (this.isStreaming || target?.role !== 'assistant' || !target.parentId) {
      return
    }
    const assistant = this.placeholder(target.parentId)
    await mutate([this.records.put(assistant), this.branchWrite(target.parentId, assistant.id), this.deps.conversationStates.patch(this.conversationId, { generating: true })], () =>
      this.deps.request('/api/chat/regenerate', { conversationId: this.conversationId, messageId, assistantMsgId: assistant.id, model: this.selectedModel, thinkingEffort: this.thinkingEffort }),
    )
  }

  editMessage = async (messageId: string, newContent: string) => {
    const target = this.allMessages.find(m => m.id === messageId)
    if (this.isStreaming || target?.role !== 'user') {
      return
    }
    const message = this.userMessage(target.parentId ?? null, newContent, target.images, target.files)
    await this.generate(new Mutation(this.userWrites(message), { keepOnError: true }), { message: newContent, parentId: message.parentId ?? null, userMsgId: message.id, skipUserInsert: false, images: target.images, files: target.files })
  }

  retryFailedMessage = async (messageId: string) => {
    const target = this.allMessages.find(m => m.id === messageId)
    if (this.isStreaming || target?.role !== 'user' || !target.sendError) {
      return
    }
    // A send that never reached the server replays its own writes; a message
    // the server kept (with a generation error) only re-triggers generation.
    const failed = this.records.failure(messageId)
    const mutation = failed ?? new Mutation([this.records.patch(messageId, { sendError: undefined })], { keepOnError: true })
    const sent = await this.generate(mutation, { message: target.content, parentId: target.parentId ?? null, userMsgId: messageId, skipUserInsert: !!this.records.confirmed(messageId), images: target.images, files: target.files })
    if (sent && this.queue.length > 0) {
      this.processQueue()
    }
  }

  discardFailedMessage = (messageId: string) => {
    this.discardedIds.add(messageId)
    this.records.failure(messageId)?.discard()
    if (this.records.confirmed(messageId)) {
      void mutate([this.records.delete(messageId), this.deps.conversationStates.update(this.conversationId, withoutBranchTo(messageId))], () => this.deps.request('/api/chat/discard', { messageId }))
    }
  }

  switchBranch = (parentKey: string, targetMessageId: string) => mutate([this.branchWrite(parentKey, targetMessageId)], () => this.deps.request('/api/chat/branch', { conversationId: this.conversationId, parentKey, selectedChildId: targetMessageId }))

  stopStreaming = () => {
    this.queue = []
    const streamingId = this.streamingId
    const writes: Write[] = [this.deps.conversationStates.patch(this.conversationId, { generating: false })]
    if (streamingId) {
      writes.push(this.records.patch(streamingId, { generating: false }))
    }
    // The stop request returns once the server persisted the final snapshot.
    void mutate(writes, () => this.deps.request('/api/chat/stop', { conversationId: this.conversationId })).then(() => (streamingId ? this.refreshMessage(streamingId) : undefined))
  }

  processQueue = () => {
    if (this.isStreaming || this.status !== 'ready' || this.queue.length === 0) {
      return
    }
    const [next, ...rest] = this.queue
    this.queue = rest
    void this.sendMessage(next.content, next.images, next.files)
  }

  editQueuedMessage = (id: string, content: string) => {
    this.queue = this.queue.map(m => (m.id === id ? { ...m, content } : m))
  }

  deleteQueuedMessage = (id: string) => {
    this.queue = this.queue.filter(m => m.id !== id)
  }

  upsertMessage = (msg: ChatMessage) => {
    const wasGenerating = this.records.confirmed(msg.id)?.generating ?? false
    if (this.discardedIds.has(msg.id) || !this.records.receive(msg)) {
      return
    }
    if (msg.generating) {
      this.lastStreamActivity = Date.now()
    } else if (wasGenerating && !this.records.list.some(m => m.generating)) {
      // The server clears the conversation flag right after the final
      // snapshot; inferring it keeps the UI correct without that echo.
      this.deps.conversationStates.merge(this.conversationId, { generating: false })
    }
    const state = this.live.get(msg.id)
    if (!state) {
      return
    }
    if (!msg.generating) {
      this.dropLive(msg.id)
      return
    }
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
      this.dropLive(msg.id)
    } else {
      this.mutateLive(next => next.set(msg.id, { ...state, ops, lastSeq }))
    }
  }

  removeMessage = (id: string) => {
    this.records.forget(id)
    this.dropLive(id)
  }

  seed = (detail: ConversationDetail) => {
    this.live = new Map()
    this.appliedCache.clear()
    this.records.reset(detail.messages)
    this.deps.conversationStates.receive(detail.conversation)
    this.status = 'ready'
  }
}
