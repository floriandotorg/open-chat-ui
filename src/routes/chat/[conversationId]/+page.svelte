<script lang="ts">
import ChatInput from '$lib/components/ChatInput.svelte'
import ChatMessage from '$lib/components/ChatMessage.svelte'
import { selectionIntersects } from '$lib/selection'
import { ChatStore } from '$lib/stores/chat.svelte'
import { chatContext } from '$lib/stores/chat-context.svelte'
import { getChatStores } from '$lib/stores/chat-sync.svelte'
import type { FileAttachment, ImageAttachment, Message } from '$lib/types'
import type { ConversationDetail } from '$lib/types/chat'
import { browser } from '$app/environment'
import { resolve } from '$app/paths'
import type { PageData } from './$types'
import { tick, untrack } from 'svelte'

let { data }: { data: PageData } = $props()

const ctx = chatContext

const createServerStore = (initial: ConversationDetail | null) => {
  if (!initial) {
    throw new Error('Server render requires the conversation detail')
  }
  const store = new ChatStore(initial.conversation.id)
  store.seed(initial)
  return store
}

const chat = $derived(browser ? getChatStores().require(data.conversationId) : createServerStore(data.initial))

let messageContainer: HTMLDivElement | undefined = $state()
let messageContent: HTMLDivElement | undefined = $state()
let stickToBottom = $state(true)
let editingQueueId = $state<string | null>(null)
let editContent = $state('')
let editTextarea: HTMLTextAreaElement | undefined = $state()
let userInteracting = $state(false)

const SCROLL_THRESHOLD = 40

const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop

const onScroll = () => {
  if (!messageContainer) return
  stickToBottom = distanceFromBottom(messageContainer) <= SCROLL_THRESHOLD
}

const selectionInsideContainer = (): boolean => selectionIntersects(messageContainer)

const onPointerDown = () => {
  userInteracting = true
}

const onPointerUp = () => {
  userInteracting = selectionInsideContainer()
}

const onSelectionChange = () => {
  if (!chat.isStreaming) return
  userInteracting = selectionInsideContainer()
}

const scrollToBottom = () => {
  if (messageContainer) {
    messageContainer.scrollTop = messageContainer.scrollHeight
  }
}

$effect(() => {
  const store = chat
  untrack(() => {
    stickToBottom = true
    scrollToBottom()
    store.processQueue()
  })
})

// Follows every height change: new messages, streamed text, and off-screen
// rows resolving their real size after content-visibility skipped them.
$effect(() => {
  if (!messageContent) return
  const observer = new ResizeObserver(() => {
    if (stickToBottom && !userInteracting) {
      scrollToBottom()
    }
  })
  observer.observe(messageContent)
  return () => observer.disconnect()
})

$effect(() => {
  chat.selectedModel = ctx.selectedModel
})

$effect(() => {
  chat.thinkingEffort = ctx.thinkingEffort
})

$effect(() => {
  const convId = data.conversationId
  ctx.generatingConversationId = chat.isStreaming ? convId : null
  return () => {
    if (ctx.generatingConversationId === convId) ctx.generatingConversationId = null
  }
})

const handleSubmit = (content: string, images?: ImageAttachment[], files?: FileAttachment[]) => {
  stickToBottom = true
  void chat.sendMessage(content, images, files)
}

const handleRegenerate = (messageId: string) => {
  stickToBottom = true
  void chat.regenerateMessage(messageId)
}

const handleEdit = (messageId: string, content: string) => {
  stickToBottom = true
  void chat.editMessage(messageId, content)
}

const handleRetry = (messageId: string) => {
  stickToBottom = true
  void chat.retryFailedMessage(messageId)
}

const handleDiscard = (messageId: string) => {
  chat.discardFailedMessage(messageId)
}

const handleSwitchBranch = (messageId: string, direction: 'prev' | 'next') => {
  const msg = chat.messages.find(m => m.id === messageId)
  if (!msg) return

  const parentKey = msg.parentId ?? '__root__'
  const siblings = chat.allMessages.filter(m => (m.parentId ?? '__root__') === parentKey).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const currentIdx = siblings.findIndex(s => s.id === messageId)
  const newIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1
  if (newIdx < 0 || newIdx >= siblings.length) return

  void chat.switchBranch(parentKey, siblings[newIdx].id)
}

const startEdit = (entry: { id: string; content: string }) => {
  editingQueueId = entry.id
  editContent = entry.content
  tick().then(() => {
    if (editTextarea) {
      editTextarea.focus()
      editTextarea.style.height = 'auto'
      editTextarea.style.height = `${editTextarea.scrollHeight}px`
    }
  })
}

const saveEdit = () => {
  if (editingQueueId && editContent.trim()) {
    chat.editQueuedMessage(editingQueueId, editContent.trim())
  }
  editingQueueId = null
  editContent = ''
}

const cancelEdit = () => {
  editingQueueId = null
  editContent = ''
}

const handleEditKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    saveEdit()
  }
  if (e.key === 'Escape') {
    cancelEdit()
  }
}

const autoResizeEdit = () => {
  if (!editTextarea) return
  editTextarea.style.height = 'auto'
  editTextarea.style.height = `${editTextarea.scrollHeight}px`
}

const isEmptyGeneration = (message: Message) => message.generating && !message.content && !message.thinking && !message.toolCalls?.length && !message.codeExecutions?.length
</script>

{#snippet typingDots()}
  <div class="flex justify-start">
    <div class="flex max-w-[90%] gap-3">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">AI</div>
      <div class="flex items-center gap-1 py-2.5">
        <span class="h-2 w-2 animate-bounce rounded-full bg-gray-400 dark:bg-neutral-400" style="animation-delay:0ms"></span>
        <span class="h-2 w-2 animate-bounce rounded-full bg-gray-400 dark:bg-neutral-400" style="animation-delay:150ms"></span>
        <span class="h-2 w-2 animate-bounce rounded-full bg-gray-400 dark:bg-neutral-400" style="animation-delay:300ms"></span>
      </div>
    </div>
  </div>
{/snippet}

<svelte:window onpointerdown={onPointerDown} onpointerup={onPointerUp} onselectionchange={onSelectionChange} />
<div class="relative flex h-full flex-col">
  <div bind:this={messageContainer} onscroll={onScroll} class="flex flex-1 flex-col overflow-y-auto px-4 pt-16 pb-32 lg:px-8">
    <div bind:this={messageContent} class="mt-auto w-full space-y-6">
      {#each chat.messages as message (message.id)}
        {#if isEmptyGeneration(message)}
          {@render typingDots()}
        {:else}
          <ChatMessage
            {message}
            onregenerate={handleRegenerate}
            onedit={handleEdit}
            onswitchbranch={handleSwitchBranch}
            onretry={handleRetry}
            ondiscard={handleDiscard}
          />
        {/if}
      {/each}
      {#if chat.status === 'loading'}
        <div class="loading-skeleton space-y-6" aria-label="Loading conversation">
          <div class="ml-auto h-10 w-1/3 rounded-2xl bg-gray-100 dark:bg-neutral-700/60"></div>
          <div class="space-y-2">
            <div class="h-3 w-5/6 rounded-full bg-gray-100 dark:bg-neutral-700/60"></div>
            <div class="h-3 w-4/6 rounded-full bg-gray-100 dark:bg-neutral-700/60"></div>
            <div class="h-3 w-3/6 rounded-full bg-gray-100 dark:bg-neutral-700/60"></div>
          </div>
        </div>
      {:else if chat.status === 'missing'}
        <div class="py-16 text-center text-sm text-gray-500 dark:text-neutral-400">
          This conversation no longer exists. <a href={resolve('/chat')} class="font-medium text-blue-500 hover:underline">Start a new chat</a>
        </div>
      {:else if chat.status === 'error'}
        <div class="py-16 text-center text-sm text-gray-500 dark:text-neutral-400">
          Couldn't load this conversation. <button onclick={() => getChatStores().revalidate(data.conversationId)} class="cursor-pointer font-medium text-blue-500 hover:underline">Try again</button>
        </div>
      {/if}
      {#each chat.messageQueue as entry (entry.id)}
        <div class="flex justify-end">
          <div class="flex max-w-[80%] flex-col items-end">
            {#if editingQueueId === entry.id}
              <div class="w-full min-w-50 rounded-2xl border border-blue-400 bg-gray-100 px-4 py-2.5 dark:border-blue-600 dark:bg-neutral-700">
                <textarea
                  bind:this={editTextarea}
                  bind:value={editContent}
                  onkeydown={handleEditKeydown}
                  oninput={autoResizeEdit}
                  rows="1"
                  class="w-full resize-none bg-transparent text-sm outline-none dark:text-white"
                ></textarea>
                <div class="mt-1.5 flex justify-end gap-1.5">
                  <button
                    onclick={cancelEdit}
                    class="rounded-lg px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-200 dark:text-neutral-400 dark:hover:bg-neutral-600"
                  >Cancel</button>
                  <button
                    onclick={saveEdit}
                    class="rounded-lg bg-blue-500 px-2.5 py-1 text-xs text-white transition-colors hover:bg-blue-600"
                  >Save</button>
                </div>
              </div>
            {:else}
              <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-100 px-4 py-2.5 text-gray-900 dark:border-neutral-500 dark:bg-neutral-700 dark:text-gray-100">
                {#if entry.images?.length || entry.files?.length}
                  <div class="mb-2 flex flex-wrap gap-2">
                    {#if entry.images?.length}
                      {#each entry.images as img (img.id)}
                        <img
                          src="/api/uploads/{img.id}"
                          alt="Attached"
                          class="max-h-48 max-w-xs rounded-lg object-contain"
                        />
                      {/each}
                    {/if}
                    {#if entry.files?.length}
                      {#each entry.files as file (file.id)}
                        <div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white/60 px-3 py-1.5 dark:border-neutral-600 dark:bg-neutral-700/60">
                          <svg class="h-4 w-4 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span class="max-w-40 truncate text-xs text-gray-600 dark:text-neutral-300">{file.filename}</span>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
                <div class="whitespace-pre-wrap text-sm">{entry.content}</div>
              </div>
              <div class="mt-1 flex gap-0.5">
                <button onclick={() => startEdit(entry)} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Edit queued message">
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button onclick={() => chat.deleteQueuedMessage(entry.id)} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400" aria-label="Delete queued message">
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <div class="absolute inset-x-0 bottom-0 z-10">
    <ChatInput
      onsubmit={handleSubmit}
      disabled={!ctx.selectedModel}
      isStreaming={chat.isStreaming}
      onstop={chat.stopStreaming}
    />
  </div>
</div>
