<script lang="ts">
import ChatInput from '$lib/components/ChatInput.svelte'
import ChatMessage from '$lib/components/ChatMessage.svelte'
import StreamingText from '$lib/components/StreamingText.svelte'
import { createChatStore } from '$lib/stores/chat.svelte'
import { consumePendingMessage } from '$lib/stores/pending-message'
import type { Message } from '$lib/types'
import { invalidateAll } from '$app/navigation'
import type { PageData } from './$types'
import { getContext, onMount } from 'svelte'

let { data }: { data: PageData } = $props()

const ctx: { selectedModel: string } = getContext('chat-provider')
const chat = createChatStore()

let messageContainer: HTMLDivElement | undefined = $state()

chat.onFirstReply = async (conversationId: string) => {
  const res = await fetch('/api/chat/title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  })
  if (res.ok) {
    await invalidateAll()
  }
}

$effect(() => {
  chat.messages = data.messages.map((m: (typeof data.messages)[number]) => ({
    ...m,
    role: m.role as Message['role'],
    createdAt: new Date(m.createdAt),
  }))
})

$effect(() => {
  chat.selectedModel = ctx.selectedModel
})

$effect(() => {
  if (messageContainer) {
    void chat.messages.length
    void chat.streamingText
    messageContainer.scrollTop = messageContainer.scrollHeight
  }
})

onMount(() => {
  const pending = consumePendingMessage()
  if (pending) {
    chat.sendMessage(data.conversation.id, pending, data.conversation.systemPrompt ?? undefined)
  }
})

const handleSubmit = (content: string) => {
  chat.sendMessage(data.conversation.id, content, data.conversation.systemPrompt ?? undefined)
}
</script>

<div class="flex h-full flex-col">
  <div bind:this={messageContainer} class="flex-1 overflow-y-auto px-4 py-6">
    <div class="mx-auto max-w-3xl space-y-6">
      {#each chat.messages as message (message.id)}
        <ChatMessage {message} />
      {/each}
      <StreamingText text={chat.streamingText} />
    </div>
  </div>

  <ChatInput
    onsubmit={handleSubmit}
    disabled={!ctx.selectedModel}
    isStreaming={chat.isStreaming}
    onstop={chat.stopStreaming}
  />
</div>
