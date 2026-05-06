<script lang="ts">
import ConversationList from '$lib/components/ConversationList.svelte'
import ModelPicker from '$lib/components/ModelPicker.svelte'
import SystemPromptPicker from '$lib/components/SystemPromptPicker.svelte'
import ThinkingEffortPicker from '$lib/components/ThinkingEffortPicker.svelte'
import TtsPlayer from '$lib/components/TtsPlayer.svelte'
import { createTtsPlayer } from '$lib/stores/tts-player.svelte'
import type { Conversation, ThinkingEffort } from '$lib/types'
import { afterNavigate, goto, invalidateAll } from '$app/navigation'
import { resolve } from '$app/paths'
import { page } from '$app/state'
import type { LayoutData } from './$types'
import type { Snippet } from 'svelte'
import { onMount, setContext } from 'svelte'
import { fade } from 'svelte/transition'

let { data, children }: { data: LayoutData; children: Snippet } = $props()

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 500
const SIDEBAR_DEFAULT = 260
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const setCookie = (name: string, value: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API lacks Safari/Firefox support
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

let sidebarOpen = $state(true)
// svelte-ignore state_referenced_locally
let selectedModel = $state(data.selectedModel ?? '')
// svelte-ignore state_referenced_locally
let selectedModelName = $state(data.selectedModelName ?? '')
// svelte-ignore state_referenced_locally
let thinkingEffort = $state<ThinkingEffort>((data.thinkingEffort as ThinkingEffort) ?? 'none')
// svelte-ignore state_referenced_locally
let sidebarWidth = $state(data.sidebarWidth ?? SIDEBAR_DEFAULT)
let isResizing = $state(false)
let isMobile = $state(false)
let currentSystemPromptId = $state<string | null>(null)

onMount(() => {
  const mql = window.matchMedia('(max-width: 767px)')
  isMobile = mql.matches
  if (isMobile) sidebarOpen = false

  const onMediaChange = (e: MediaQueryListEvent) => {
    isMobile = e.matches
    if (e.matches) sidebarOpen = false
  }
  mql.addEventListener('change', onMediaChange)
  return () => mql.removeEventListener('change', onMediaChange)
})

$effect(() => {
  setCookie('thinking-effort', thinkingEffort)
})

$effect(() => {
  setCookie('tts-speed', String(ttsPlayer.speed))
})

const startResize = (e: MouseEvent) => {
  e.preventDefault()
  isResizing = true
  const onMouseMove = (e: MouseEvent) => {
    sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX))
  }
  const onMouseUp = () => {
    isResizing = false
    setCookie('sidebar-width', String(sidebarWidth))
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const currentConversationId = $derived(page.params.conversationId)
const currentConversation = $derived(data.conversations.find(c => c.id === currentConversationId))

$effect(() => {
  if (currentConversation) {
    currentSystemPromptId = currentConversation.systemPromptId ?? data.systemPrompts.find(p => p.isDefault)?.id ?? null
  } else {
    currentSystemPromptId = data.systemPrompts.find(p => p.isDefault)?.id ?? null
  }
})

const changeSystemPrompt = async (promptId: string | null) => {
  if (!currentConversationId) return
  const prompt = data.systemPrompts.find(p => p.id === promptId)
  await fetch(`/api/conversations/${currentConversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemPromptId: promptId,
      systemPrompt: prompt?.content ?? null,
    }),
  })
  await invalidateAll()
}

afterNavigate(() => {
  if (isMobile) sidebarOpen = false
})

let generatingConversationId = $state<string | null>(null)

// svelte-ignore state_referenced_locally
const ttsPlayer = createTtsPlayer(data.ttsSpeed ?? 1)
setContext('tts-player', ttsPlayer)

setContext('chat-provider', {
  get selectedModel() {
    return selectedModel
  },
  set selectedModel(v: string) {
    selectedModel = v
  },
  get thinkingEffort() {
    return thinkingEffort
  },
  set thinkingEffort(v: ThinkingEffort) {
    thinkingEffort = v
  },
  get generatingConversationId() {
    return generatingConversationId
  },
  set generatingConversationId(v: string | null) {
    generatingConversationId = v
  },
  get currentSystemPromptId() {
    return currentSystemPromptId
  },
})

let newChatError = $state('')
let sidebarSearchQuery = $state('')

const clearSidebarSearch = () => {
  sidebarSearchQuery = ''
}

const newChat = async () => {
  newChatError = ''
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPromptId: currentSystemPromptId }),
    })
    if (!res.ok) {
      newChatError = 'Failed to create conversation'
      return
    }
    const conv: Conversation = await res.json()
    await goto(resolve(`/chat/${conv.id}`))
  } catch {
    newChatError = 'Failed to create conversation'
  }
}

const handleModelChange = (id: string, name: string) => {
  setCookie('selected-model', id)
  setCookie('selected-model-name', name)
  selectedModelName = name
}

const userName = $derived(data.user?.name ?? data.user?.email ?? 'User')
const userInitial = $derived(userName[0]?.toUpperCase() ?? 'U')

const handleGlobalKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault()
    void newChat()
  }
}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />
<TtsPlayer />
<div class="flex h-dvh bg-white text-gray-900 dark:bg-neutral-800 dark:text-gray-100" class:select-none={isResizing}>
  {#if isMobile && sidebarOpen}
    <button class="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onclick={() => sidebarOpen = false} aria-label="Close sidebar" tabindex="-1" transition:fade={{ duration: 200 }}></button>
  {/if}

  {#if sidebarOpen || isMobile}
    <aside
      class="sidebar-surface flex flex-col {isMobile ? `fixed inset-y-0 left-0 z-50 w-[280px] transition-transform duration-200 ease-in-out ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}` : 'relative shrink-0'}"
      style={isMobile ? undefined : `width: ${sidebarWidth}px`}
    >
      <div class="liquid-glass-bar-top absolute inset-x-0 top-0 z-10" style="padding-top: max(0.75rem, env(safe-area-inset-top))">
        <div class="flex items-center justify-between px-3.5 pb-2.5">
          <div class="flex items-center gap-2">
            <svg class="h-6 w-6 text-blue-500" viewBox="0 0 192 192" fill="none">
              <rect width="192" height="192" rx="32" fill="currentColor"/>
              <path d="M56 80c0-13.255 10.745-24 24-24h32c13.255 0 24 10.745 24 24v24c0 13.255-10.745 24-24 24H96l-16 16v-16H80c-13.255 0-24-10.745-24-24V80z" fill="white"/>
              <circle cx="80" cy="92" r="6" fill="currentColor"/>
              <circle cx="96" cy="92" r="6" fill="currentColor"/>
              <circle cx="112" cy="92" r="6" fill="currentColor"/>
            </svg>
            <span class="text-[13px] font-semibold tracking-tight">Open Chat UI</span>
          </div>
          <div class="flex items-center gap-0.5">
            <button onclick={newChat} aria-label="New chat" class="rounded-lg p-1.5 transition-colors hover:bg-black/8 dark:hover:bg-white/10">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button onclick={() => sidebarOpen = false} aria-label="Close sidebar" class="rounded-lg p-1.5 transition-colors hover:bg-black/8 dark:hover:bg-white/10">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>
        <div class="px-2.5 pb-2.5">
          <div class="relative">
            <svg class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              bind:value={sidebarSearchQuery}
              placeholder="Search chats and messages"
              class="w-full rounded-full bg-black/[0.04] py-1.5 pl-8 pr-8 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:bg-white/80 focus:ring-2 focus:ring-blue-500/25 dark:bg-white/[0.06] dark:text-white dark:placeholder-neutral-500 dark:focus:bg-white/10 dark:focus:ring-blue-400/30"
            />
            {#if sidebarSearchQuery}
              <button
                onclick={clearSidebarSearch}
                aria-label="Clear search"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 transition hover:bg-black/10 hover:text-gray-600 dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-300"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            {/if}
          </div>
        </div>
      </div>

      <ConversationList conversations={data.conversations} currentId={currentConversationId} {generatingConversationId} bind:searchQuery={sidebarSearchQuery} />

      <div class="liquid-glass-bar-bottom absolute inset-x-0 bottom-0 z-10 p-2" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))">
        <a href={resolve('/settings')} class="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-medium text-white">
            {userInitial}
          </span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{userName}</span>
          <span aria-label="Settings" class="rounded-lg p-1.5 text-gray-500 transition-colors group-hover:text-gray-900 dark:text-neutral-400 dark:group-hover:text-white">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </span>
        </a>
      </div>
      {#if !isMobile}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          role="separator"
          aria-orientation="vertical"
          onmousedown={startResize}
          class="group absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize"
        >
          <div class="h-full w-px ml-auto bg-transparent transition-colors group-hover:w-full group-hover:bg-blue-400 dark:group-hover:bg-blue-500" class:!w-full={isResizing} class:!bg-blue-400={isResizing} class:dark:!bg-blue-500={isResizing}></div>
        </div>
      {/if}
    </aside>
  {/if}

  <main class="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <header class="liquid-glass-bar-top absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-2.5" style="padding-top: max(0.625rem, env(safe-area-inset-top))">
      <div class="flex items-center gap-3">
        {#if !sidebarOpen || isMobile}
          <button onclick={() => sidebarOpen = !sidebarOpen} aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} class="rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        {/if}
        {#if isMobile}
          <button onclick={newChat} aria-label="New chat" class="-ml-1.5 rounded-lg p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        {/if}
        <ModelPicker providers={data.providers} bind:selectedModel modelNameHint={selectedModelName} onmodelchange={handleModelChange} />
      </div>
      <div class="flex items-center gap-1">
        <SystemPromptPicker
          prompts={data.systemPrompts}
          bind:selectedId={currentSystemPromptId}
          onchange={changeSystemPrompt}
        />
        <ThinkingEffortPicker bind:thinkingEffort />
      </div>
    </header>

    {#if newChatError}
      <div class="absolute inset-x-4 top-14 z-30 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600 shadow-md dark:bg-red-900/40 dark:text-red-400">{newChatError}</div>
    {/if}
    <div class="min-h-0 min-w-0 flex-1">
      {@render children()}
    </div>
  </main>
</div>
