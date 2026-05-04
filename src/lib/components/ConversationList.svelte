<script lang="ts">
import { splitByTerms } from '$lib/highlight'
import type { Conversation } from '$lib/types'
import { goto, invalidateAll } from '$app/navigation'
import { resolve } from '$app/paths'
import ConfirmDialog from './ConfirmDialog.svelte'

let {
  conversations,
  currentId,
  generatingConversationId,
  searchQuery = $bindable(''),
}: {
  conversations: Conversation[]
  currentId?: string
  generatingConversationId?: string | null
  searchQuery?: string
} = $props()

interface SearchHit {
  id: string
  title: string
  titleHasMatch: boolean
  snippet: string | null
  snippetRole: 'user' | 'assistant' | null
  messageMatchCount: number
  updatedAt: string
  score: number
}

let showDeleteDialog = $state(false)
let deleteTarget = $state<{ id: string; title: string } | null>(null)
let searchResults = $state<SearchHit[] | null>(null)
let searchTerms = $state<string[]>([])
let searching = $state(false)

const trimmedQuery = $derived(searchQuery.trim())
const isSearching = $derived(trimmedQuery.length >= 2)

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

  for (const conv of conversations) {
    const date = new Date(conv.updatedAt)
    if (date >= today) buckets[0][1].push(conv)
    else if (date >= yesterday) buckets[1][1].push(conv)
    else if (date >= weekAgo) buckets[2][1].push(conv)
    else buckets[3][1].push(conv)
  }

  return buckets.filter(([, items]) => items.length > 0)
})

let activeRequest = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null

$effect(() => {
  const query = trimmedQuery
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (query.length < 2) {
    searchResults = null
    searchTerms = []
    searching = false
    return
  }
  searching = true
  const requestId = ++activeRequest
  debounceTimer = setTimeout(async () => {
    const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(query)}`)
    if (requestId !== activeRequest) return
    if (res.ok) {
      const data = await res.json()
      searchResults = data.results
      searchTerms = data.terms
    }
    searching = false
  }, 180)
})

const formatDate = (value: string | Date) => {
  const date = typeof value === 'string' ? new Date(value) : value
  const now = new Date()
  const diffDays = (now.getTime() - date.getTime()) / 86400000
  if (diffDays < 1 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' })
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

const promptDelete = (e: Event, id: string, title: string) => {
  e.stopPropagation()
  e.preventDefault()
  deleteTarget = { id, title }
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

<nav class="no-scrollbar flex-1 overflow-y-auto px-2.5 pt-[calc(env(safe-area-inset-top)+6.5rem)] pb-[calc(env(safe-area-inset-bottom)+3.75rem)]">
  {#if isSearching}
    {#if searchResults === null && searching}
      <div class="px-3 py-8 text-center text-sm text-gray-400 dark:text-neutral-500">Searching…</div>
    {:else if searchResults && searchResults.length > 0}
      <div class="convo-section-label">
        {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
      </div>
      {#each searchResults as hit (hit.id)}
        <a
          href={resolve(`/chat/${hit.id}`)}
          class="convo-item group block rounded-xl px-3 py-2 text-sm {hit.id === currentId ? 'convo-item-active' : ''}"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">
                  {#each splitByTerms(hit.title, searchTerms) as seg, n (n)}{#if seg.match}<mark class="rounded-sm bg-yellow-200/80 px-0.5 text-gray-900 dark:bg-yellow-400/30 dark:text-yellow-50">{seg.text}</mark>{:else}{seg.text}{/if}{/each}
                </span>
                {#if hit.id === generatingConversationId}
                  <svg class="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                {/if}
              </div>
              {#if hit.snippet}
                <div class="mt-1 line-clamp-2 text-xs leading-snug text-gray-500 dark:text-neutral-400">
                  <span class="mr-1 inline-block rounded bg-black/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:bg-white/10 dark:text-neutral-400">{hit.snippetRole === 'user' ? 'You' : 'AI'}</span>
                  {#each splitByTerms(hit.snippet, searchTerms) as seg, n (n)}{#if seg.match}<mark class="rounded-sm bg-yellow-200/80 px-0.5 text-gray-900 dark:bg-yellow-400/30 dark:text-yellow-50">{seg.text}</mark>{:else}{seg.text}{/if}{/each}
                </div>
              {/if}
              <div class="mt-1 flex items-center gap-2 text-[11px] text-gray-400 dark:text-neutral-500">
                <span>{formatDate(hit.updatedAt)}</span>
                {#if hit.messageMatchCount > 1}
                  <span aria-hidden="true">·</span>
                  <span>{hit.messageMatchCount} matching messages</span>
                {/if}
              </div>
            </div>
            <button
              onclick={(e) => promptDelete(e, hit.id, hit.title)}
              aria-label="Delete conversation"
              class="shrink-0 rounded-lg p-1 opacity-0 transition hover:bg-black/15 dark:hover:bg-white/15 group-hover:opacity-100"
            >
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </a>
      {/each}
    {:else if searchResults}
      <div class="px-3 py-8 text-center text-sm text-gray-400 dark:text-neutral-500">No matches for &ldquo;{trimmedQuery}&rdquo;</div>
    {/if}
  {:else}
    {#each groupedConversations as [label, items] (label)}
      <div class="mb-0.5">
        <div class="convo-section-label">{label}</div>
        {#each items as conv (conv.id)}
          <a
            href={resolve(`/chat/${conv.id}`)}
            class="convo-item group flex items-center justify-between rounded-xl px-3 py-2 text-sm {conv.id === currentId ? 'convo-item-active' : ''}"
          >
            <span class="truncate">{conv.title}</span>
            {#if conv.generating || conv.id === generatingConversationId}
              <svg class="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            {:else}
              <button
                onclick={(e) => promptDelete(e, conv.id, conv.title)}
                aria-label="Delete conversation"
                class="shrink-0 rounded-lg p-1 opacity-0 transition hover:bg-black/15 dark:hover:bg-white/15 group-hover:opacity-100"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            {/if}
          </a>
        {/each}
      </div>
    {/each}
    {#if groupedConversations.length === 0}
      <div class="px-3 py-8 text-center text-sm text-gray-400 dark:text-neutral-500">No chats yet</div>
    {/if}
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
