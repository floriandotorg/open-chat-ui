<script lang="ts">
import type { Conversation } from '$lib/types'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'

const newChat = async () => {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const conv: Conversation = await res.json()
  await goto(resolve(`/chat/${conv.id}`))
}
</script>

<div class="flex h-full flex-col items-center justify-center gap-4 text-center">
  <div class="rounded-full bg-gray-100 p-4 dark:bg-gray-800">
    <svg class="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  </div>
  <div>
    <h2 class="text-lg font-medium">No conversation selected</h2>
    <p class="mt-1 text-sm text-gray-500">Start a new chat or select one from the sidebar.</p>
  </div>
  <button
    onclick={newChat}
    class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
  >
    New Chat
  </button>
</div>
