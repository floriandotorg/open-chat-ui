import type { BranchMap } from '$lib/message-tree'
import { createStableAnnotator, resolveAndAnnotate } from '$lib/message-tree'
import { createOptimisticMap } from '$lib/stores/optimistic.svelte'
import type { FileAttachment, ImageAttachment, Message, ThinkingEffort } from '$lib/types'

interface QueueEntry {
  id: string
  conversationId: string
  content: string
  systemPrompt?: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
}

const ROOT_KEY = '__root__'

export const createChatStore = (initialData?: { allMessages: Message[]; activeBranches: BranchMap }) => {
  let confirmed = $state<Message[]>(initialData?.allMessages ?? [])
  let activeBranches = $state<BranchMap>(initialData?.activeBranches ?? {})
  let currentConversationId = $state<string | null>(initialData?.allMessages[0]?.conversationId ?? null)
  const pending = createOptimisticMap<Message>()
  const pendingBranchWrites = new Map<string, string>()
  const discardedIds = new Set<string>()

  let messageQueue = $state<QueueEntry[]>([])
  let selectedModel = $state('')
  let thinkingEffort = $state<ThinkingEffort>('none')
  let awaitingGeneration = $state(false)
  let serverGenerating = $state(false)
  let onFirstReply = $state<((conversationId: string) => void) | null>(null)
  let activeConversationId: string | null = null

  const annotate = createStableAnnotator<Message>()
  const allMessages = $derived<Message[]>([...confirmed, ...pending.values().filter(m => m.conversationId === currentConversationId && !confirmed.some(c => c.id === m.id))])
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
    if (msg.generating) awaitingGeneration = false
    const inheritedError = (confirmed.find(m => m.id === msg.id) ?? pending.get(msg.id))?.sendError
    pending.confirm(msg.id)
    const existing = confirmed.find(m => m.id === msg.id)
    const merged = inheritedError && !msg.sendError ? { ...msg, sendError: inheritedError } : msg
    confirmed = existing ? confirmed.map(m => (m.id === msg.id ? merged : m)) : [...confirmed, merged]
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
    seed,
  }
}
