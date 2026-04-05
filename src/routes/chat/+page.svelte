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

<div class="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
  <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 shadow-lg">
    <svg class="h-7 w-7 text-white" viewBox="0 0 192 192" fill="none">
      <path d="M56 80c0-13.255 10.745-24 24-24h32c13.255 0 24 10.745 24 24v24c0 13.255-10.745 24-24 24H96l-16 16v-16H80c-13.255 0-24-10.745-24-24V80z" fill="currentColor"/>
      <circle cx="80" cy="92" r="6" fill="#1e293b"/>
      <circle cx="96" cy="92" r="6" fill="#1e293b"/>
      <circle cx="112" cy="92" r="6" fill="#1e293b"/>
    </svg>
  </div>
  <div>
    <h2 class="text-xl font-semibold text-gray-900 dark:text-white">What can I help you with?</h2>
    <p class="mt-1.5 text-sm text-gray-400 dark:text-neutral-500">Start a new conversation to get going.</p>
  </div>
  <button
    onclick={newChat}
    class="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
  >
    New Chat
  </button>
</div>
