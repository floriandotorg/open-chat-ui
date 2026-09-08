<script lang="ts">
import ChatInput from '$lib/components/ChatInput.svelte'
import { chatContext } from '$lib/stores/chat-context.svelte'
import { conversationsStore } from '$lib/stores/conversations.svelte'
import { setPendingMessage } from '$lib/stores/pending-message'
import type { FileAttachment, ImageAttachment } from '$lib/types'
import type { ConversationSummary } from '$lib/types/chat'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { tick } from 'svelte'

const ctx = chatContext

let error = $state('')
let textarea: HTMLTextAreaElement | undefined = $state()

$effect(() => {
  ctx.newChatFocusToken
  tick().then(() => textarea?.focus())
})

const handleSubmit = async (content: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
  error = ''
  setPendingMessage(content, images, files)
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPromptId: ctx.currentSystemPromptId }),
  })
  if (!res.ok) {
    error = 'Failed to create conversation'
    return
  }
  const conv: ConversationSummary = await res.json()
  if (!conv?.id) {
    error = 'Failed to create conversation'
    return
  }
  conversationsStore.upsert({ ...conv, updatedAt: new Date(conv.updatedAt) })
  await goto(resolve(`/chat/${conv.id}`))
}
</script>

<div class="flex h-full flex-col items-center justify-center px-4 lg:px-8">
  <div class="mb-8 text-center">
    <h2 class="text-xl font-semibold text-gray-900 dark:text-white">What can I help you with?</h2>
  </div>
  <div class="w-full">
    <ChatInput onsubmit={handleSubmit} disabled={!ctx.selectedModel} bind:textarea />
    {#if error}
      <p class="mt-3 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
    {/if}
  </div>
</div>
