<script lang="ts">
import ChatInput from '$lib/components/ChatInput.svelte'
import { chatContext } from '$lib/stores/chat-context.svelte'
import { getChatStores } from '$lib/stores/chat-sync.svelte'
import type { FileAttachment, ImageAttachment } from '$lib/types'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { page } from '$app/state'
import { onMount, tick } from 'svelte'

const ctx = chatContext

let textarea: HTMLTextAreaElement | undefined = $state()

$effect(() => {
  ctx.newChatFocusToken
  tick().then(() => textarea?.focus())
})

// The conversation exists locally first; the first POST /api/chat creates it
// on the server, so starting a chat costs a single request.
const startConversation = (content: string, images?: ImageAttachment[], files?: FileAttachment[], replaceState = false) => {
  const id = crypto.randomUUID()
  const store = getChatStores().createEmpty({ id, title: 'New Chat', favorite: false, generating: false, systemPromptId: ctx.currentSystemPromptId, defaultModel: ctx.selectedModel || null, updatedAt: new Date() })
  store.selectedModel = ctx.selectedModel
  store.thinkingEffort = ctx.thinkingEffort
  void store.sendMessage(content, images, files)
  void goto(resolve(`/chat/${id}`), { replaceState })
}

const handleSubmit = (content: string, images?: ImageAttachment[], files?: FileAttachment[]) => startConversation(content, images, files)

onMount(() => {
  const query = page.url.searchParams.get('q')?.trim()
  if (query) {
    startConversation(query, undefined, undefined, true)
  }
})
</script>

<div class="flex h-full flex-col items-center justify-center px-4 lg:px-8">
  <div class="mb-8 text-center">
    <h2 class="text-xl font-semibold text-gray-900 dark:text-white">What can I help you with?</h2>
  </div>
  <div class="w-full">
    <ChatInput onsubmit={handleSubmit} disabled={!ctx.selectedModel} bind:textarea />
  </div>
</div>
