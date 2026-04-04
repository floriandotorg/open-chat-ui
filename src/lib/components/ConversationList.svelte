<script lang="ts">
import type { Conversation } from '$lib/types'
import { goto, invalidateAll } from '$app/navigation'
import { resolve } from '$app/paths'

let { conversations, currentId }: { conversations: Conversation[]; currentId?: string } = $props()

const newChat = async () => {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const conv: Conversation = await res.json()
  await goto(resolve(`/chat/${conv.id}`))
}

const deleteConversation = async (e: Event, id: string) => {
  e.stopPropagation()
  e.preventDefault()
  await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
  if (currentId === id) {
    await goto(resolve('/chat'))
  }
  await invalidateAll()
}
</script>

<div class="flex h-full flex-col">
  <div class="p-3">
    <button
      onclick={newChat}
      class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      New Chat
    </button>
  </div>

  <nav class="flex-1 space-y-0.5 overflow-y-auto px-2">
    {#each conversations as conv (conv.id)}
      <a
        href={resolve(`/chat/${conv.id}`)}
        class="group flex items-center justify-between rounded-lg px-3 py-2 text-sm transition {conv.id === currentId
          ? 'bg-gray-200 dark:bg-gray-800'
          : 'hover:bg-gray-100 dark:hover:bg-gray-800/50'}"
      >
        <span class="truncate">{conv.title}</span>
        <button
          onclick={(e) => deleteConversation(e, conv.id)}
          aria-label="Delete conversation"
          class="shrink-0 rounded p-1 opacity-0 transition hover:bg-gray-300 group-hover:opacity-100 dark:hover:bg-gray-700"
        >
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </a>
    {/each}
  </nav>
</div>
