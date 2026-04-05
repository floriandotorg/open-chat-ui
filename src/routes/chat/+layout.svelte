<script lang="ts">
import ConversationList from '$lib/components/ConversationList.svelte'
import ModelPicker from '$lib/components/ModelPicker.svelte'
import type { Conversation } from '$lib/types'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { page } from '$app/state'
import type { LayoutData } from './$types'
import type { Snippet } from 'svelte'
import { onMount, setContext } from 'svelte'

let { data, children }: { data: LayoutData; children: Snippet } = $props()

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 500
const SIDEBAR_DEFAULT = 260
const STORAGE_KEY = 'sidebar-width'

let sidebarOpen = $state(true)
let selectedModel = $state('')
let sidebarWidth = $state(SIDEBAR_DEFAULT)
let isResizing = $state(false)

onMount(() => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(stored)))
})

const startResize = (e: MouseEvent) => {
  e.preventDefault()
  isResizing = true
  const onMouseMove = (e: MouseEvent) => {
    sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX))
  }
  const onMouseUp = () => {
    isResizing = false
    localStorage.setItem(STORAGE_KEY, String(sidebarWidth))
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const currentConversationId = $derived(page.params.conversationId)

setContext('chat-provider', {
  get selectedModel() {
    return selectedModel
  },
  set selectedModel(v: string) {
    selectedModel = v
  },
})

const newChat = async () => {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const conv: Conversation = await res.json()
  await goto(resolve(`/chat/${conv.id}`))
}

const userName = $derived(data.user?.name ?? data.user?.email ?? 'User')
const userInitial = $derived(userName[0]?.toUpperCase() ?? 'U')
</script>

<div class="flex h-screen bg-white text-gray-900 dark:bg-neutral-800 dark:text-gray-100" class:select-none={isResizing}>
  {#if sidebarOpen}
    <aside class="relative flex shrink-0 flex-col bg-gray-50 dark:bg-neutral-900" style="width: {sidebarWidth}px">
      <div class="flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-2">
          <svg class="h-6 w-6 text-blue-500" viewBox="0 0 192 192" fill="none">
            <rect width="192" height="192" rx="32" fill="currentColor"/>
            <path d="M56 80c0-13.255 10.745-24 24-24h32c13.255 0 24 10.745 24 24v24c0 13.255-10.745 24-24 24H96l-16 16v-16H80c-13.255 0-24-10.745-24-24V80z" fill="white"/>
            <circle cx="80" cy="92" r="6" fill="currentColor"/>
            <circle cx="96" cy="92" r="6" fill="currentColor"/>
            <circle cx="112" cy="92" r="6" fill="currentColor"/>
          </svg>
          <span class="text-sm font-semibold">Open Chat UI</span>
        </div>
        <div class="flex items-center gap-0.5">
          <button onclick={newChat} aria-label="New chat" class="rounded-lg p-1.5 transition-colors hover:bg-gray-200 dark:hover:bg-neutral-800">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button onclick={() => sidebarOpen = false} aria-label="Close sidebar" class="rounded-lg p-1.5 transition-colors hover:bg-gray-200 dark:hover:bg-neutral-800">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      <ConversationList conversations={data.conversations} currentId={currentConversationId} />

      <div class="border-t border-gray-200 p-2.5 dark:border-neutral-700/50">
        <div class="flex items-center justify-between rounded-xl px-2 py-1.5">
          <div class="flex items-center gap-2.5">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-medium text-white">
              {userInitial}
            </div>
            <span class="truncate text-sm font-medium">{userName}</span>
          </div>
          <a href={resolve('/settings')} aria-label="Settings" class="rounded-lg p-1.5 transition-colors hover:bg-gray-200 dark:hover:bg-neutral-800">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </a>
        </div>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="separator"
        aria-orientation="vertical"
        onmousedown={startResize}
        class="group absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize"
      >
        <div class="h-full w-px ml-auto bg-gray-200 transition-colors group-hover:w-full group-hover:bg-blue-400 dark:bg-neutral-700 dark:group-hover:bg-blue-500" class:w-full={isResizing} class:bg-blue-400={isResizing} class:dark:bg-blue-500={isResizing}></div>
      </div>
    </aside>
  {/if}

  <main class="flex flex-1 flex-col overflow-hidden">
    <header class="flex items-center gap-3 px-4 py-2.5">
      {#if !sidebarOpen}
        <button onclick={() => sidebarOpen = true} aria-label="Open sidebar" class="rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      {/if}
      <ModelPicker providers={data.providers} bind:selectedModel />
    </header>

    <div class="flex-1 overflow-hidden">
      {@render children()}
    </div>
  </main>
</div>
