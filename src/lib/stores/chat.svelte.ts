import type { ChatStreamEvent, Message } from '$lib/types'

export const createChatStore = () => {
  let messages = $state<Message[]>([])
  let streamingText = $state('')
  let isStreaming = $state(false)
  let selectedProvider = $state('anthropic')
  let selectedModel = $state('claude-sonnet-4-20250514')
  let abortController = $state<AbortController | null>(null)

  const sendMessage = async (conversationId: string, content: string, systemPrompt?: string) => {
    isStreaming = true
    streamingText = ''
    abortController = new AbortController()

    messages.push({
      id: crypto.randomUUID(),
      conversationId,
      role: 'user',
      content,
      createdAt: new Date(),
    })

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          provider: selectedProvider,
          model: selectedModel,
          message: content,
          systemPrompt,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const err = await response.json()
        streamingText = ''
        isStreaming = false
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
          const event: ChatStreamEvent = JSON.parse(line.slice(6))

          if (event.type === 'text_delta') {
            streamingText += event.text ?? ''
          }
          if (event.type === 'error') {
            streamingText = ''
            isStreaming = false
            throw new Error(event.error ?? 'Stream error')
          }
          if (event.type === 'done') {
            messages.push({
              id: crypto.randomUUID(),
              conversationId,
              role: 'assistant',
              content: streamingText,
              provider: selectedProvider,
              model: selectedModel,
              createdAt: new Date(),
            })
            streamingText = ''
            isStreaming = false
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (streamingText) {
          messages.push({
            id: crypto.randomUUID(),
            conversationId,
            role: 'assistant',
            content: streamingText,
            provider: selectedProvider,
            model: selectedModel,
            createdAt: new Date(),
          })
        }
        streamingText = ''
        isStreaming = false
        return
      }
      streamingText = ''
      isStreaming = false
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
    get isStreaming() {
      return isStreaming
    },
    get selectedProvider() {
      return selectedProvider
    },
    set selectedProvider(v: string) {
      selectedProvider = v
    },
    get selectedModel() {
      return selectedModel
    },
    set selectedModel(v: string) {
      selectedModel = v
    },
    sendMessage,
    stopStreaming,
  }
}
