<script lang="ts">
import ConversationList from '$lib/components/ConversationList.svelte'
import ModelPicker from '$lib/components/ModelPicker.svelte'
import { resolve } from '$app/paths'
import { page } from '$app/state'
import type { LayoutData } from './$types'
import type { Snippet } from 'svelte'
import { setContext } from 'svelte'

let { data, children }: { data: LayoutData; children: Snippet } = $props()

let sidebarOpen = $state(true)
let selectedModel = $state('')

const currentConversationId = $derived(page.params.conversationId)

setContext('chat-provider', {
  get selectedModel() {
    return selectedModel
  },
  set selectedModel(v: string) {
    selectedModel = v
  },
})
</script>

<div class="flex h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
  {#if sidebarOpen}
    <aside class="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <span class="text-sm font-semibold">Conversations</span>
        <button onclick={() => sidebarOpen = false} aria-label="Close sidebar" class="rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-800">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <ConversationList conversations={data.conversations} currentId={currentConversationId} />
      <div class="border-t border-gray-200 p-3 dark:border-gray-800">
        <a href={resolve('/settings')} class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-200 dark:hover:bg-gray-800">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </a>
      </div>
    </aside>
  {/if}

  <main class="flex flex-1 flex-col overflow-hidden">
    <header class="flex items-center gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
      {#if !sidebarOpen}
        <button onclick={() => sidebarOpen = true} aria-label="Open sidebar" class="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
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
