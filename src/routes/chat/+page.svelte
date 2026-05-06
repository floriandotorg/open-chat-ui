<script lang="ts">
import ChatInput from '$lib/components/ChatInput.svelte'
import { setPendingMessage } from '$lib/stores/pending-message'
import type { Conversation, FileAttachment, ImageAttachment } from '$lib/types'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { getContext } from 'svelte'

const ctx: { selectedModel: string; currentSystemPromptId: string | null } = getContext('chat-provider')

let error = $state('')

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
  const conv: Conversation = await res.json()
  if (!conv?.id) {
    error = 'Failed to create conversation'
    return
  }
  await goto(resolve(`/chat/${conv.id}`))
}
</script>

<div class="flex h-full flex-col items-center justify-center px-4 lg:px-8">
  <div class="mb-8 text-center">
    <h2 class="text-xl font-semibold text-gray-900 dark:text-white">What can I help you with?</h2>
  </div>
  <div class="w-full">
    <ChatInput onsubmit={handleSubmit} disabled={!ctx.selectedModel} />
    {#if error}
      <p class="mt-3 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
    {/if}
  </div>
</div>
