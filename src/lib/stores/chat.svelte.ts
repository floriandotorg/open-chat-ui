import type { ChatStreamEvent, CodeExecutionBlock, ImageAttachment, Message, ThinkingEffort, ToolCallInfo } from '$lib/types'

export const createChatStore = () => {
  let messages = $state<Message[]>([])
  let streamingText = $state('')
  let streamingThinking = $state('')
  let thinkingDuration = $state<number | null>(null)
  let isStreaming = $state(false)
  let isThinking = $state(false)
  let streamingToolCalls = $state<ToolCallInfo[]>([])
  let streamingCodeExecutions = $state<CodeExecutionBlock[]>([])
  let selectedModel = $state('anthropic/claude-sonnet-4-20250514')
  let thinkingEffort = $state<ThinkingEffort>('none')
  let abortController = $state<AbortController | null>(null)
  let onFirstReply = $state<((conversationId: string) => void) | null>(null)
  let activeConversationId = $state<string | null>(null)

  const resetStreamingState = () => {
    streamingText = ''
    streamingThinking = ''
    thinkingDuration = null
    streamingToolCalls = []
    streamingCodeExecutions = []
    isStreaming = false
    isThinking = false
  }

  const buildMessage = (conversationId: string): Message => ({
    id: crypto.randomUUID(),
    conversationId,
    role: 'assistant',
    content: streamingText,
    model: selectedModel,
    thinking: streamingThinking || undefined,
    thinkingDuration: thinkingDuration ?? undefined,
    toolCalls: streamingToolCalls.length ? [...streamingToolCalls] : undefined,
    codeExecutions: streamingCodeExecutions.length ? [...streamingCodeExecutions] : undefined,
    createdAt: new Date(),
  })

  const sendMessage = async (conversationId: string, content: string, systemPrompt?: string, images?: ImageAttachment[]) => {
    const isFirstMessage = messages.length === 0
    activeConversationId = conversationId
    isStreaming = true
    isThinking = false
    streamingText = ''
    streamingThinking = ''
    thinkingDuration = null
    streamingToolCalls = []
    streamingCodeExecutions = []
    abortController = new AbortController()
    const codeExecRawInputs = new Map<string, string>()
    let thinkingStartTime: number | null = null

    messages.push({
      id: crypto.randomUUID(),
      conversationId,
      role: 'user',
      content,
      images: images?.length ? images : undefined,
      createdAt: new Date(),
    })

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          model: selectedModel,
          message: content,
          images: images?.length ? images : undefined,
          systemPrompt,
          thinkingEffort,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const err = await response.json()
        resetStreamingState()
        throw new Error(err.message ?? 'Request failed')
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Response body is not readable')
      }
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          if (activeConversationId !== conversationId) return

          const event: ChatStreamEvent = JSON.parse(line.slice(6))

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
            streamingToolCalls = [
              ...streamingToolCalls,
              {
                ...event.toolCall,
                textOffset: streamingText.length,
              },
            ]
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
          if (event.type === 'error') {
            resetStreamingState()
            throw new Error(event.error ?? 'Stream error')
          }
          if (event.type === 'done') {
            if (isThinking) {
              isThinking = false
              thinkingDuration = thinkingStartTime ? Math.round((Date.now() - thinkingStartTime) / 1000) : null
            }
            messages.push(buildMessage(conversationId))
            resetStreamingState()
            if (isFirstMessage && onFirstReply) {
              onFirstReply(conversationId)
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (streamingText && activeConversationId === conversationId) {
          messages.push(buildMessage(conversationId))
        }
        resetStreamingState()
        return
      }
      resetStreamingState()
      throw err
    } finally {
      abortController = null
    }
  }

  const stopStreaming = () => {
    abortController?.abort()
  }

  return {
    get messages() {
      return messages
    },
    set messages(v: Message[]) {
      messages = v
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
    stopStreaming,
  }
}
