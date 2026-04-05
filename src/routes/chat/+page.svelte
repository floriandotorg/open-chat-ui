<script lang="ts">
import ChatInput from '$lib/components/ChatInput.svelte'
import { setPendingMessage } from '$lib/stores/pending-message'
import type { Conversation, FileAttachment, ImageAttachment } from '$lib/types'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { page } from '$app/state'
import { getContext } from 'svelte'

const ctx: { selectedModel: string } = getContext('chat-provider')

let queryHandled = false

const handleSubmit = async (content: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
  setPendingMessage(content, images, files)
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const conv: Conversation = await res.json()
  await goto(resolve(`/chat/${conv.id}`))
}

$effect(() => {
  const prompt = page.url.searchParams.get('q')
  if (prompt && ctx.selectedModel && !queryHandled) {
    queryHandled = true
    handleSubmit(prompt)
  }
})
</script>

<div class="flex h-full flex-col items-center justify-center px-4">
  <div class="mb-8 text-center">
    <h2 class="text-xl font-semibold text-gray-900 dark:text-white">What can I help you with?</h2>
  </div>
  <div class="w-full max-w-3xl">
    <ChatInput onsubmit={handleSubmit} disabled={!ctx.selectedModel} />
  </div>
</div>
