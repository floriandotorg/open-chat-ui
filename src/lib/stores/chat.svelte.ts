import type { BranchMap } from '$lib/message-tree'
import { createStableAnnotator, resolveAndAnnotate } from '$lib/message-tree'
import { createOptimisticMap } from '$lib/stores/optimistic.svelte'
import { applyStreamOps } from '$lib/stream-ops'
import type { FileAttachment, ImageAttachment, Message, StreamEvent, StreamOp, ThinkingEffort } from '$lib/types'

export type FetchStreamEvents = (messageId: string, from: number, to: number | null) => Promise<StreamEvent[]>

interface LiveState {
  lastSeq: number
  ops: Map<number, StreamOp[]>
  pendingGap: Promise<void> | null
}

interface ChatStoreDeps {
  fetchStreamEvents?: FetchStreamEvents
}

interface QueueEntry {
  id: string
  conversationId: string
  content: string
  systemPrompt?: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
}

const ROOT_KEY = '__root__'

export const createChatStore = (initialData?: { allMessages: Message[]; activeBranches: BranchMap }, deps?: ChatStoreDeps) => {
  let confirmed = $state<Message[]>(initialData?.allMessages ?? [])
  let activeBranches = $state<BranchMap>(initialData?.activeBranches ?? {})
  let currentConversationId = $state<string | null>(initialData?.allMessages[0]?.conversationId ?? null)
  const pending = createOptimisticMap<Message>()
  const pendingBranchWrites = new Map<string, string>()
  const discardedIds = new Set<string>()

  // Live stream deltas per assistant message id, applied on top of the
  // confirmed snapshot (messages.eventSeq marks the folded prefix). State
  // objects and the map itself are replaced on every change so $derived
  // recomputes; appliedCache keeps object identity stable per message.
  let live = $state<Map<string, LiveState>>(new Map())
  const appliedCache = new Map<string, { snapshot: Message; lastSeq: number; result: Message }>()
  let lastStreamActivity = $state(0)

  let messageQueue = $state<QueueEntry[]>([])
  let selectedModel = $state('')
  let thinkingEffort = $state<ThinkingEffort>('none')
  let awaitingGeneration = $state(false)
  let serverGenerating = $state(false)
  let onFirstReply = $state<((conversationId: string) => void) | null>(null)
  let activeConversationId: string | null = null

  const annotate = createStableAnnotator<Message>()

  const withLive = (m: Message): Message => {
    const state = live.get(m.id)
    if (!state) return m
    const eventSeq = m.eventSeq ?? 0
    if (state.lastSeq <= eventSeq) return m
    const cached = appliedCache.get(m.id)
    if (cached && cached.snapshot === m && cached.lastSeq === state.lastSeq) return cached.result
    const ops: StreamOp[] = []
    for (let s = eventSeq + 1; s <= state.lastSeq; ++s) {
      const batch = state.ops.get(s)
      if (batch) ops.push(...batch)
    }
    const result = applyStreamOps(m, ops)
    appliedCache.set(m.id, { snapshot: m, lastSeq: state.lastSeq, result })
    return result
  }

  const allMessages = $derived<Message[]>([...confirmed.map(withLive), ...pending.values().filter(m => m.conversationId === currentConversationId && !confirmed.some(c => c.id === m.id))])
  const messages = $derived<(Message & { siblingIndex: number; siblingCount: number })[]>(annotate(allMessages, activeBranches))
  const streamingMessage = $derived(allMessages.find(m => m.role === 'assistant' && m.generating))
  const isStreaming = $derived(awaitingGeneration || serverGenerating || !!streamingMessage)

  const setBranchLocal = (parentKey: string, messageId: string) => {
    pendingBranchWrites.set(parentKey, messageId)
    activeBranches = { ...activeBranches, [parentKey]: messageId }
  }

  const applyServerBranches = (branches: BranchMap) => {
    const merged = { ...branches }
    for (const [key, value] of pendingBranchWrites) {
      if (branches[key] === value) pendingBranchWrites.delete(key)
      else merged[key] = value
    }
    activeBranches = merged
  }

  const mutateLive = (fn: (next: Map<string, LiveState>) => void) => {
    const next = new Map(live)
    fn(next)
    live = next
  }

  const confirmedEventSeq = (messageId: string): number => confirmed.find(m => m.id === messageId)?.eventSeq ?? 0

  const fillGap = async (messageId: string, from: number, to: number | null) => {
    if (!deps?.fetchStreamEvents) return
    try {
      const events = await deps.fetchStreamEvents(messageId, from, to)
      mutateLive(next => {
        const current = next.get(messageId) ?? { lastSeq: confirmedEventSeq(messageId), ops: new Map<number, StreamOp[]>(), pendingGap: null }
        const ops = new Map(current.ops)
        for (const e of events) {
          ops.set(e.seq, e.ops)
        }
        let lastSeq = current.lastSeq
        while (ops.has(lastSeq + 1)) ++lastSeq
        next.set(messageId, { ...current, ops, lastSeq })
      })
      lastStreamActivity = Date.now()
    } catch {}
  }

  const ingestEvent = (e: StreamEvent) => {
    const confirmedMsg = confirmed.find(m => m.id === e.messageId)
    // A finalized message folds every event the drained writer produced; late
    // arrivals would double-apply.
    if (confirmedMsg && !confirmedMsg.generating) return
    const eventSeq = confirmedMsg?.eventSeq ?? 0
    if (e.seq <= eventSeq) return
    const existing = live.get(e.messageId)
    if (existing && (e.seq <= existing.lastSeq || existing.ops.has(e.seq))) return
    const base: LiveState = existing ?? { lastSeq: eventSeq, ops: new Map(), pendingGap: null }
    const ops = new Map(base.ops)
    ops.set(e.seq, e.ops)
    let pendingGap = base.pendingGap
    if (e.seq > base.lastSeq + 1 && !pendingGap) {
      pendingGap = fillGap(e.messageId, base.lastSeq + 1, e.seq - 1).finally(() => {
        mutateLive(next => {
          const current = next.get(e.messageId)
          if (current) next.set(e.messageId, { ...current, pendingGap: null })
        })
      })
    }
    let lastSeq = base.lastSeq
    while (ops.has(lastSeq + 1)) ++lastSeq
    mutateLive(next => next.set(e.messageId, { ...base, ops, lastSeq, pendingGap }))
    awaitingGeneration = false
    lastStreamActivity = Date.now()
  }

  const fillMissingEvents = async (messageId: string) => {
    const state = live.get(messageId)
    if (state?.pendingGap) {
      await state.pendingGap
      return
    }
    const from = Math.max(state?.lastSeq ?? 0, confirmedEventSeq(messageId)) + 1
    await fillGap(messageId, from, null)
  }

  const getLastMessageId = (): string | null => {
    const resolved = resolveAndAnnotate(allMessages, activeBranches)
    return resolved.length > 0 ? resolved[resolved.length - 1].id : null
  }

  const postCommand = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string }
      throw new Error(err.message ?? 'Request failed')
    }
  }

  const markSendFailed = (messageId: string, err: unknown) => {
    awaitingGeneration = false
    const sendError = err instanceof Error ? err.message : 'Failed to send message'
    pending.patch(messageId, { sendError })
    if (!pending.has(messageId)) {
      confirmed = confirmed.map(m => (m.id === messageId ? { ...m, sendError } : m))
    }
    messageQueue = []
  }

  const triggerGeneration = (conversationId: string, message: string, parentId: string | null, userMsgId: string, skipUserInsert: boolean, systemPrompt?: string, images?: ImageAttachment[], files?: FileAttachment[]) =>
    postCommand('/api/chat', {
      conversationId,
      model: selectedModel,
      message,
      images: images?.length ? images : undefined,
      files: files?.length ? files : undefined,
      systemPrompt,
      thinkingEffort,
      parentId,
      userMsgId,
      skipUserInsert,
    })

  const sendMessage = async (conversationId: string, content: string, systemPrompt?: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
    if (isStreaming) {
      messageQueue = [...messageQueue, { id: crypto.randomUUID(), conversationId, content, systemPrompt, images, files }]
      return
    }

    activeConversationId = conversationId
    currentConversationId = conversationId
    const isFirstMessage = allMessages.length === 0
    const parentId = getLastMessageId()

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversationId,
      parentId,
      role: 'user',
      content,
      images: images?.length ? images : undefined,
      files: files?.length ? files : undefined,
      createdAt: new Date(),
    }
    pending.add(userMsg)
    setBranchLocal(userMsg.parentId ?? ROOT_KEY, userMsg.id)
    awaitingGeneration = true

    try {
      await triggerGeneration(conversationId, content, parentId, userMsg.id, false, systemPrompt, images, files)
      if (isFirstMessage) onFirstReply?.(conversationId)
    } catch (err) {
      markSendFailed(userMsg.id, err)
    }
  }

  const regenerateMessage = async (conversationId: string, messageId: string) => {
    if (isStreaming) return

    activeConversationId = conversationId
    awaitingGeneration = true
    try {
      await postCommand('/api/chat/regenerate', { conversationId, messageId, model: selectedModel, thinkingEffort })
    } catch (err) {
      awaitingGeneration = false
      throw err
    }
  }

  const editMessage = async (conversationId: string, messageId: string, newContent: string) => {
    if (isStreaming) return

    const targetMsg = allMessages.find(m => m.id === messageId)
    if (targetMsg?.role !== 'user') return

    activeConversationId = conversationId
    const newUserMsg: Message = {
      id: crypto.randomUUID(),
      conversationId,
      parentId: targetMsg.parentId ?? null,
      role: 'user',
      content: newContent,
      images: targetMsg.images,
      files: targetMsg.files,
      createdAt: new Date(),
    }
    pending.add(newUserMsg)
    setBranchLocal(newUserMsg.parentId ?? ROOT_KEY, newUserMsg.id)
    awaitingGeneration = true

    try {
      await postCommand('/api/chat/edit', { conversationId, messageId, content: newContent, newMessageId: newUserMsg.id })
      await triggerGeneration(conversationId, newContent, newUserMsg.parentId ?? null, newUserMsg.id, true, undefined, targetMsg.images, targetMsg.files)
    } catch (err) {
      markSendFailed(newUserMsg.id, err)
    }
  }

  const retryFailedMessage = async (conversationId: string, messageId: string) => {
    if (isStreaming) return

    const target = allMessages.find(m => m.id === messageId)
    if (target?.role !== 'user' || !target.sendError) return

    activeConversationId = conversationId
    awaitingGeneration = true
    pending.patch(messageId, { sendError: undefined })
    if (!pending.has(messageId)) {
      confirmed = confirmed.map(m => (m.id === messageId ? { ...m, sendError: undefined } : m))
    }

    try {
      await triggerGeneration(conversationId, target.content, target.parentId ?? null, messageId, !pending.has(messageId), undefined, target.images, target.files)
    } catch (err) {
      markSendFailed(messageId, err)
      return
    }

    if (messageQueue.length > 0) processQueue()
  }

  const discardFailedMessage = (messageId: string) => {
    discardedIds.add(messageId)
    pending.remove(messageId)
    confirmed = confirmed.filter(m => m.id !== messageId)
    const nextBranches: BranchMap = {}
    for (const [key, value] of Object.entries(activeBranches)) {
      if (value !== messageId) nextBranches[key] = value
    }
    activeBranches = nextBranches
    fetch('/api/chat/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    }).catch(() => {})
  }

  const switchBranch = async (conversationId: string, parentKey: string, targetMessageId: string) => {
    setBranchLocal(parentKey, targetMessageId)
    await fetch('/api/chat/branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, parentKey, selectedChildId: targetMessageId }),
    })
  }

  const stopStreaming = () => {
    messageQueue = []
    awaitingGeneration = false
    // Optimistic: unfreeze the UI immediately, the server snapshot confirms.
    const streaming = streamingMessage
    if (streaming) {
      mutateLive(next => next.delete(streaming.id))
      appliedCache.delete(streaming.id)
      confirmed = confirmed.map(m => (m.id === streaming.id ? { ...m, generating: false } : m))
    }
    const convId = activeConversationId ?? currentConversationId
    if (convId) {
      fetch('/api/chat/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId }),
      }).catch(() => {})
    }
  }

  const processQueue = () => {
    if (isStreaming || messageQueue.length === 0) return
    const [next, ...rest] = messageQueue
    messageQueue = rest
    void sendMessage(next.conversationId, next.content, next.systemPrompt, next.images, next.files)
  }

  const upsertMessage = (msg: Message) => {
    if (discardedIds.has(msg.id)) return
    if (msg.generating) {
      awaitingGeneration = false
      lastStreamActivity = Date.now()
    }
    const inheritedError = (confirmed.find(m => m.id === msg.id) ?? pending.get(msg.id))?.sendError
    pending.confirm(msg.id)
    const existing = confirmed.find(m => m.id === msg.id)
    const merged = inheritedError && !msg.sendError ? { ...msg, sendError: inheritedError } : msg
    confirmed = existing ? confirmed.map(m => (m.id === msg.id ? merged : m)) : [...confirmed, merged]
    const state = live.get(msg.id)
    if (state) {
      if (!msg.generating) {
        mutateLive(next => next.delete(msg.id))
        appliedCache.delete(msg.id)
      } else {
        // Drop ops the snapshot folded, keep anything buffered beyond it.
        const eventSeq = msg.eventSeq ?? 0
        const ops = new Map<number, StreamOp[]>()
        for (const [seq, batch] of state.ops) {
          if (seq > eventSeq) ops.set(seq, batch)
        }
        let lastSeq = eventSeq
        while (ops.has(lastSeq + 1)) ++lastSeq
        if (ops.size === 0 && !state.pendingGap) {
          mutateLive(next => next.delete(msg.id))
          appliedCache.delete(msg.id)
        } else {
          mutateLive(next => next.set(msg.id, { ...state, ops, lastSeq }))
        }
      }
    }
  }

  const removeMessage = (id: string) => {
    pending.remove(id)
    confirmed = confirmed.filter(m => m.id !== id)
  }

  const seed = (conversationId: string, allMsgs: Message[], branches: BranchMap) => {
    if (conversationId !== currentConversationId) {
      currentConversationId = conversationId
      awaitingGeneration = false
      serverGenerating = false
    }
    live = new Map()
    appliedCache.clear()
    confirmed = allMsgs
    pendingBranchWrites.clear()
    activeBranches = branches
  }

  const setConversationGenerating = (generating: boolean) => {
    serverGenerating = generating
    if (generating) awaitingGeneration = false
  }

  $effect.root(() => {
    let wasStreaming = false
    $effect(() => {
      const streaming = isStreaming
      if (wasStreaming && !streaming) queueMicrotask(processQueue)
      wasStreaming = streaming
    })
  })

  return {
    get currentConversationId() {
      return currentConversationId
    },
    get messages() {
      return messages
    },
    get allMessages() {
      return allMessages
    },
    get activeBranches() {
      return activeBranches
    },
    get streamingMessage() {
      return streamingMessage
    },
    get awaitingGeneration() {
      return awaitingGeneration
    },
    get isStreaming() {
      return isStreaming
    },
    get messageQueue() {
      return messageQueue
    },
    set messageQueue(v: QueueEntry[]) {
      messageQueue = v
    },
    get selectedModel() {
      return selectedModel
    },
    set selectedModel(v: string) {
      selectedModel = v
    },
    get thinkingEffort() {
      return thinkingEffort
    },
    set thinkingEffort(v: ThinkingEffort) {
      thinkingEffort = v
    },
    get lastStreamActivity() {
      return lastStreamActivity
    },
    get onFirstReply() {
      return onFirstReply
    },
    set onFirstReply(v: ((conversationId: string) => void) | null) {
      onFirstReply = v
    },
    sendMessage,
    regenerateMessage,
    editMessage,
    retryFailedMessage,
    discardFailedMessage,
    switchBranch,
    stopStreaming,
    processQueue,
    editQueuedMessage: (id: string, content: string) => {
      messageQueue = messageQueue.map(m => (m.id === id ? { ...m, content } : m))
    },
    deleteQueuedMessage: (id: string) => {
      messageQueue = messageQueue.filter(m => m.id !== id)
    },
    upsertMessage,
    removeMessage,
    applyServerBranches,
    setConversationGenerating,
    ingestEvent,
    fillMissingEvents,
    seed,
  }
}
