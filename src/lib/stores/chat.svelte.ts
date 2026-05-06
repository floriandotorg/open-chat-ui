import type { BranchMap } from '$lib/message-tree'
import { resolveAndAnnotate } from '$lib/message-tree'
import type { ChatStreamEvent, CodeExecutionBlock, FileAttachment, ImageAttachment, Message, ThinkingEffort, ToolCallInfo } from '$lib/types'

export const createChatStore = (initialData?: { allMessages: Message[]; activeBranches: BranchMap }) => {
  let allMessages = $state<Message[]>(initialData?.allMessages ?? [])
  let activeBranches = $state<BranchMap>(initialData?.activeBranches ?? {})
  const messages = $derived<(Message & { siblingIndex: number; siblingCount: number })[]>(resolveAndAnnotate(allMessages, activeBranches))
  let streamingText = $state('')
  let streamingThinking = $state('')
  let thinkingDuration = $state<number | null>(null)
  let isStreaming = $state(false)
  let isThinking = $state(false)
  let streamingToolCalls = $state<ToolCallInfo[]>([])
  let streamingCodeExecutions = $state<CodeExecutionBlock[]>([])
  let selectedModel = $state('')
  let thinkingEffort = $state<ThinkingEffort>('none')
  let abortController = $state<AbortController | null>(null)
  let onFirstReply = $state<((conversationId: string) => void) | null>(null)
  let activeConversationId = $state<string | null>(null)

  interface QueueEntry {
    id: string
    conversationId: string
    content: string
    systemPrompt?: string
    images?: ImageAttachment[]
    files?: FileAttachment[]
  }

  let messageQueue = $state<QueueEntry[]>([])

  const resetStreamingState = () => {
    streamingText = ''
    streamingThinking = ''
    thinkingDuration = null
    streamingToolCalls = []
    streamingCodeExecutions = []
    isStreaming = false
    isThinking = false
  }

  const buildMessage = (conversationId: string, parentId?: string | null): Message => ({
    id: crypto.randomUUID(),
    conversationId,
    parentId,
    role: 'assistant',
    content: streamingText,
    model: selectedModel,
    thinking: streamingThinking || undefined,
    thinkingDuration: thinkingDuration ?? undefined,
    toolCalls: streamingToolCalls.length ? [...streamingToolCalls] : undefined,
    codeExecutions: streamingCodeExecutions.length ? [...streamingCodeExecutions] : undefined,
    createdAt: new Date(),
  })

  const getLastMessageId = (): string | null => {
    const resolved = resolveAndAnnotate(allMessages, activeBranches)
    return resolved.length > 0 ? resolved[resolved.length - 1].id : null
  }

  const processStream = async (initialResponse: Response, conversationId: string, initialParentId: string | null, controller: AbortController) => {
    const codeExecRawInputs = new Map<string, string>()
    let thinkingStartTime: number | null = null
    let parentId: string | null = initialParentId
    let cursor = 0
    let completed = false

    const handleEvent = (event: ChatStreamEvent) => {
      if (event.type === 'stream_meta') {
        if (event.parentId) parentId = event.parentId
        return
      }
      if (event.type === 'stream_end') {
        completed = true
        return
      }
      if (event.type === 'thinking_delta') {
        if (!thinkingStartTime) {
          thinkingStartTime = Date.now()
          isThinking = true
        }
        streamingThinking += event.thinking ?? ''
      }
      if (event.type === 'text_delta') {
        if (isThinking) {
          isThinking = false
          thinkingDuration = thinkingStartTime ? Math.round((Date.now() - thinkingStartTime) / 1000) : null
        }
        streamingText += event.text ?? ''
      }
      if (event.type === 'tool_call' && event.toolCall) {
        streamingToolCalls = [...streamingToolCalls, { ...event.toolCall, textOffset: streamingText.length }]
      }
      if (event.type === 'tool_result' && event.toolResult) {
        streamingToolCalls = streamingToolCalls.map(tc => (tc.id === event.toolResult?.toolCallId ? { ...tc, result: event.toolResult.result } : tc))
      }
      if (event.type === 'code_execution_start' && event.codeExecution) {
        streamingCodeExecutions = [
          ...streamingCodeExecutions,
          {
            id: event.codeExecution.id,
            name: event.codeExecution.name,
            input: {},
            textOffset: streamingText.length,
          },
        ]
      }
      if (event.type === 'code_execution_delta' && event.codeExecutionDelta) {
        const { id, partialInput } = event.codeExecutionDelta
        const raw = (codeExecRawInputs.get(id) ?? '') + partialInput
        codeExecRawInputs.set(id, raw)
        let input: Record<string, unknown>
        try {
          input = JSON.parse(raw)
        } catch {
          input = { _raw: raw }
        }
        streamingCodeExecutions = streamingCodeExecutions.map(ce => (ce.id === id ? { ...ce, input } : ce))
      }
      if (event.type === 'code_execution_result' && event.codeExecutionResult) {
        const { id, ...result } = event.codeExecutionResult
        streamingCodeExecutions = streamingCodeExecutions.map(ce => (ce.id === id ? { ...ce, ...result } : ce))
      }
      if (event.type === 'code_execution_files' && event.codeExecutionFiles) {
        const { id, files } = event.codeExecutionFiles
        streamingCodeExecutions = streamingCodeExecutions.map(ce => (ce.id === id ? { ...ce, files } : ce))
      }
      if (event.type === 'error') {
        throw new Error(event.error ?? 'Stream error')
      }
      if (event.type === 'done') {
        if (isThinking) {
          isThinking = false
          thinkingDuration = thinkingStartTime ? Math.round((Date.now() - thinkingStartTime) / 1000) : null
        }
        const assistantMsg = buildMessage(conversationId, parentId)
        if (event.messageId) {
          assistantMsg.id = event.messageId
        }
        allMessages = [...allMessages, assistantMsg]
        if (parentId) {
          activeBranches = { ...activeBranches, [parentId]: assistantMsg.id }
        }
        resetStreamingState()
      }
    }

    const consumeResponse = async (response: Response) => {
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Response body is not readable')
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          if (abortController !== controller) {
            reader.cancel().catch(() => {})
            return
          }
          let idLine: string | undefined
          let dataLine: string | undefined
          for (const line of block.split('\n')) {
            if (line.startsWith('id: ')) idLine = line.slice(4)
            else if (line.startsWith('data: ')) dataLine = line.slice(6)
          }
          if (!dataLine) continue
          const event: ChatStreamEvent = JSON.parse(dataLine)
          handleEvent(event)
          if (idLine !== undefined) cursor = Number(idLine) + 1
          if (completed) return
        }
      }
    }

    try {
      await consumeResponse(initialResponse)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (completed || abortController !== controller) throw err
    }

    while (!completed && abortController === controller) {
      let reconnect: Response
      try {
        reconnect = await fetch(`/api/chat/stream/${conversationId}?cursor=${cursor}`, {
          signal: controller.signal,
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        await new Promise(r => setTimeout(r, 500))
        continue
      }
      if (reconnect.status === 404) {
        return
      }
      if (!reconnect.ok) {
        throw new Error('Failed to reconnect to stream')
      }
      try {
        await consumeResponse(reconnect)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        if (completed) return
        await new Promise(r => setTimeout(r, 500))
      }
    }
  }

  const sendMessage = async (conversationId: string, content: string, systemPrompt?: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
    if (isStreaming) {
      messageQueue = [
        ...messageQueue,
        {
          id: crypto.randomUUID(),
          conversationId,
          content,
          systemPrompt,
          images,
          files,
        },
      ]
      return
    }

    const isFirstMessage = allMessages.length === 0
    activeConversationId = conversationId
    isStreaming = true
    isThinking = false
    streamingText = ''
    streamingThinking = ''
    thinkingDuration = null
    streamingToolCalls = []
    streamingCodeExecutions = []
    const ctrl = new AbortController()
    abortController = ctrl

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
    allMessages = [...allMessages, userMsg]
    const parentKey = parentId ?? '__root__'
    activeBranches = { ...activeBranches, [parentKey]: userMsg.id }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          model: selectedModel,
          message: content,
          images: images?.length ? images : undefined,
          files: files?.length ? files : undefined,
          systemPrompt,
          thinkingEffort,
          parentId,
          userMsgId: userMsg.id,
        }),
        signal: ctrl.signal,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message ?? 'Request failed')
      }

      await processStream(response, conversationId, userMsg.id, ctrl)

      if (isFirstMessage && onFirstReply) {
        onFirstReply(conversationId)
      }
    } catch (err) {
      const isMine = abortController === ctrl
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (isMine && streamingText) {
          const assistantMsg = buildMessage(conversationId, userMsg.id)
          allMessages = [...allMessages, assistantMsg]
          if (userMsg.id) {
            activeBranches = { ...activeBranches, [userMsg.id]: assistantMsg.id }
          }
        }
        if (isMine) {
          resetStreamingState()
          abortController = null
        }
        return
      }
      if (isMine) {
        resetStreamingState()
        messageQueue = []
        abortController = null
      }
      throw err
    }

    if (abortController !== ctrl) return
    abortController = null
    if (messageQueue.length > 0) {
      const [next, ...rest] = messageQueue
      messageQueue = rest
      await sendMessage(next.conversationId, next.content, next.systemPrompt, next.images, next.files)
    }
  }

  const regenerateMessage = async (conversationId: string, messageId: string) => {
    if (isStreaming) return

    activeConversationId = conversationId
    isStreaming = true
    isThinking = false
    streamingText = ''
    streamingThinking = ''
    thinkingDuration = null
    streamingToolCalls = []
    streamingCodeExecutions = []
    const ctrl = new AbortController()
    abortController = ctrl

    const targetMsg = allMessages.find(m => m.id === messageId)
    const userParentId = targetMsg?.parentId ?? null

    try {
      const response = await fetch('/api/chat/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          messageId,
          model: selectedModel,
          thinkingEffort,
        }),
        signal: ctrl.signal,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message ?? 'Request failed')
      }

      await processStream(response, conversationId, userParentId, ctrl)
    } catch (err) {
      const isMine = abortController === ctrl
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (isMine && streamingText) {
          const assistantMsg = buildMessage(conversationId, userParentId)
          allMessages = [...allMessages, assistantMsg]
          if (userParentId) {
            activeBranches = { ...activeBranches, [userParentId]: assistantMsg.id }
          }
        }
        if (isMine) {
          resetStreamingState()
          abortController = null
        }
        return
      }
      if (isMine) {
        resetStreamingState()
        abortController = null
      }
      throw err
    }

    if (abortController === ctrl) abortController = null
  }

  const editMessage = async (conversationId: string, messageId: string, newContent: string) => {
    if (isStreaming) return

    const targetMsg = allMessages.find(m => m.id === messageId)
    if (!targetMsg || targetMsg.role !== 'user') return

    const res = await fetch('/api/chat/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, messageId, content: newContent }),
    })

    if (!res.ok) return

    const { newMessageId } = await res.json()

    const newUserMsg: Message = {
      id: newMessageId,
      conversationId,
      parentId: targetMsg.parentId,
      role: 'user',
      content: newContent,
      images: targetMsg.images,
      files: targetMsg.files,
      createdAt: new Date(),
    }

    allMessages = [...allMessages, newUserMsg]
    const parentKey = targetMsg.parentId ?? '__root__'
    activeBranches = { ...activeBranches, [parentKey]: newMessageId }

    activeConversationId = conversationId
    isStreaming = true
    isThinking = false
    streamingText = ''
    streamingThinking = ''
    thinkingDuration = null
    streamingToolCalls = []
    streamingCodeExecutions = []
    const ctrl = new AbortController()
    abortController = ctrl

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          model: selectedModel,
          message: newContent,
          images: targetMsg.images?.length ? targetMsg.images : undefined,
          files: targetMsg.files?.length ? targetMsg.files : undefined,
          thinkingEffort,
          parentId: targetMsg.parentId,
          userMsgId: newMessageId,
          skipUserInsert: true,
        }),
        signal: ctrl.signal,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message ?? 'Request failed')
      }

      await processStream(response, conversationId, newMessageId, ctrl)
    } catch (err) {
      const isMine = abortController === ctrl
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (isMine && streamingText) {
          const assistantMsg = buildMessage(conversationId, newMessageId)
          allMessages = [...allMessages, assistantMsg]
          activeBranches = { ...activeBranches, [newMessageId]: assistantMsg.id }
        }
        if (isMine) {
          resetStreamingState()
          abortController = null
        }
        return
      }
      if (isMine) {
        resetStreamingState()
        abortController = null
      }
      throw err
    }

    if (abortController === ctrl) abortController = null
  }

  const switchBranch = async (conversationId: string, parentKey: string, targetMessageId: string) => {
    activeBranches = { ...activeBranches, [parentKey]: targetMessageId }

    await fetch('/api/chat/branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, parentKey, selectedChildId: targetMessageId }),
    })
  }

  const stopStreaming = () => {
    messageQueue = []
    const convId = activeConversationId
    abortController?.abort()
    if (convId) {
      fetch(`/api/chat/stream/${convId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const detachStream = () => {
    abortController?.abort()
    abortController = null
    activeConversationId = null
    resetStreamingState()
  }

  const resumeStream = async (conversationId: string) => {
    if (isStreaming && activeConversationId === conversationId) return
    activeConversationId = conversationId
    isStreaming = true
    isThinking = false
    streamingText = ''
    streamingThinking = ''
    thinkingDuration = null
    streamingToolCalls = []
    streamingCodeExecutions = []
    const ctrl = new AbortController()
    abortController = ctrl
    try {
      const response = await fetch(`/api/chat/stream/${conversationId}?cursor=0`, {
        signal: ctrl.signal,
      })
      if (!response.ok) {
        if (abortController === ctrl) {
          resetStreamingState()
          abortController = null
        }
        return
      }
      await processStream(response, conversationId, null, ctrl)
    } catch {
      if (abortController === ctrl) {
        resetStreamingState()
        abortController = null
      }
      return
    }
    if (abortController !== ctrl) return
    abortController = null
    if (messageQueue.length > 0) {
      const [next, ...rest] = messageQueue
      messageQueue = rest
      await sendMessage(next.conversationId, next.content, next.systemPrompt, next.images, next.files)
    }
  }

  const editQueuedMessage = (id: string, content: string) => {
    messageQueue = messageQueue.map(m => (m.id === id ? { ...m, content } : m))
  }

  const deleteQueuedMessage = (id: string) => {
    messageQueue = messageQueue.filter(m => m.id !== id)
  }

  return {
    get messages() {
      return messages
    },
    get allMessages() {
      return allMessages
    },
    set allMessages(v: Message[]) {
      allMessages = v
    },
    get activeBranches() {
      return activeBranches
    },
    set activeBranches(v: BranchMap) {
      activeBranches = v
    },
    get streamingText() {
      return streamingText
    },
    get streamingThinking() {
      return streamingThinking
    },
    get thinkingDuration() {
      return thinkingDuration
    },
    get isStreaming() {
      return isStreaming
    },
    get isThinking() {
      return isThinking
    },
    get streamingToolCalls() {
      return streamingToolCalls
    },
    get streamingCodeExecutions() {
      return streamingCodeExecutions
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
    switchBranch,
    stopStreaming,
    detachStream,
    resumeStream,
    editQueuedMessage,
    deleteQueuedMessage,
    processQueue: () => {
      if (isStreaming || messageQueue.length === 0) return
      const [next, ...rest] = messageQueue
      messageQueue = rest
      sendMessage(next.conversationId, next.content, next.systemPrompt, next.images, next.files)
    },
  }
}
