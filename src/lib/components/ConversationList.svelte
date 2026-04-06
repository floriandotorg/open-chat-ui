<script lang="ts">
import type { Conversation } from '$lib/types'
import { goto, invalidateAll } from '$app/navigation'
import { resolve } from '$app/paths'
import ConfirmDialog from './ConfirmDialog.svelte'

let { conversations, currentId }: { conversations: Conversation[]; currentId?: string } = $props()

let searchQuery = $state('')
let showDeleteDialog = $state(false)
let deleteTarget = $state<{ id: string; title: string } | null>(null)

const filteredConversations = $derived(searchQuery.trim() ? conversations.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase())) : conversations)

const groupedConversations = $derived.by(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  const buckets: [string, Conversation[]][] = [
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Older', []],
  ]

  for (const conv of filteredConversations) {
    const date = new Date(conv.updatedAt)
    if (date >= today) buckets[0][1].push(conv)
    else if (date >= yesterday) buckets[1][1].push(conv)
    else if (date >= weekAgo) buckets[2][1].push(conv)
    else buckets[3][1].push(conv)
  }

  return buckets.filter(([, items]) => items.length > 0)
})

const promptDelete = (e: Event, conv: Conversation) => {
  e.stopPropagation()
  e.preventDefault()
  deleteTarget = { id: conv.id, title: conv.title }
  showDeleteDialog = true
}

const confirmDelete = async () => {
  if (!deleteTarget) return
  const id = deleteTarget.id
  deleteTarget = null
  await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
  if (currentId === id) {
    await goto(resolve('/chat'))
  }
  await invalidateAll()
}
</script>

<div class="px-2.5 pb-2 pt-1">
  <div class="relative">
    <svg class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search"
      class="w-full rounded-lg bg-gray-100 py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-1 focus:ring-gray-300 dark:bg-neutral-800 dark:text-white dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
    />
  </div>
</div>

<nav class="flex-1 overflow-y-auto px-2.5">
  {#each groupedConversations as [label, items] (label)}
    <div class="mb-1">
      <div class="px-2 pb-1 pt-3 text-xs font-medium text-gray-400 dark:text-neutral-500">{label}</div>
      {#each items as conv (conv.id)}
        <a
          href={resolve(`/chat/${conv.id}`)}
          class="group flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors {conv.id === currentId
            ? 'bg-gray-200 dark:bg-neutral-700/70'
            : 'hover:bg-gray-100 dark:hover:bg-neutral-800'}"
        >
          <span class="truncate">{conv.title}</span>
          <button
            onclick={(e) => promptDelete(e, conv)}
            aria-label="Delete conversation"
            class="shrink-0 rounded-lg p-1 opacity-0 transition hover:bg-gray-300 dark:hover:bg-neutral-600 {conv.id === currentId ? 'group-hover:opacity-100' : 'group-hover:opacity-100'}"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </a>
      {/each}
    </div>
  {/each}
  {#if groupedConversations.length === 0}
    <div class="px-3 py-8 text-center text-sm text-gray-400 dark:text-neutral-500">
      {searchQuery ? 'No matching chats' : 'No chats yet'}
    </div>
  {/if}
</nav>

<ConfirmDialog
  bind:open={showDeleteDialog}
  title="Delete chat"
  description="Are you sure you want to delete &quot;{deleteTarget?.title}&quot;? This cannot be undone."
  confirmLabel="Delete"
  destructive
  onconfirm={confirmDelete}
/>
