<script lang="ts">
import ChatInput from '$lib/components/ChatInput.svelte'
import ChatMessage from '$lib/components/ChatMessage.svelte'
import StreamingText from '$lib/components/StreamingText.svelte'
import { createChatStore } from '$lib/stores/chat.svelte'
import { consumePendingMessage } from '$lib/stores/pending-message'
import type { Message, ThinkingEffort } from '$lib/types'
import { invalidateAll } from '$app/navigation'
import type { PageData } from './$types'
import { getContext, onMount, tick, untrack } from 'svelte'

let { data }: { data: PageData } = $props()

const ctx: { selectedModel: string; thinkingEffort: ThinkingEffort; generatingConversationId: string | null } = getContext('chat-provider')
const chat = createChatStore()

let messageContainer: HTMLDivElement | undefined = $state()
let stickToBottom = $state(true)
let editingQueueId = $state<string | null>(null)
let editContent = $state('')
let editTextarea: HTMLTextAreaElement | undefined = $state()
let queueMounted = $state(false)

const SCROLL_THRESHOLD = 40

const onScroll = () => {
  if (!messageContainer) return
  const { scrollTop, scrollHeight, clientHeight } = messageContainer
  stickToBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD
}

const scrollToBottom = () => {
  if (messageContainer) {
    messageContainer.scrollTop = messageContainer.scrollHeight
  }
}

chat.onFirstReply = async (conversationId: string) => {
  const res = await fetch('/api/chat/title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  })
  if (res.ok) {
    await invalidateAll()
  }
}

let lastSyncedConversationId: string | undefined

$effect(() => {
  const serverAllMessages = data.allMessages
  const serverBranches = data.activeBranches
  const convId = data.conversation.id
  const existing = untrack(() => chat.allMessages)

  const conversationChanged = lastSyncedConversationId !== undefined && lastSyncedConversationId !== convId
  lastSyncedConversationId = convId

  if (conversationChanged) {
    untrack(() => chat.stopStreaming())
  }

  const thinkingByContent = new Map<string, { thinking?: string; thinkingDuration?: number }>()
  for (const m of existing) {
    if (m.thinking) {
      thinkingByContent.set(`${m.role}:${m.content}`, { thinking: m.thinking, thinkingDuration: m.thinkingDuration })
    }
  }

  const mapped: Message[] = serverAllMessages.map((m: (typeof serverAllMessages)[number]) => {
    const cached = thinkingByContent.get(`${m.role}:${m.content}`)
    return {
      ...m,
      role: m.role as Message['role'],
      createdAt: new Date(m.createdAt),
      thinking: cached?.thinking,
      thinkingDuration: cached?.thinkingDuration,
    } as Message
  })

  if (untrack(() => chat.isStreaming)) return
  chat.allMessages = mapped
  chat.activeBranches = serverBranches
})

$effect(() => {
  chat.selectedModel = ctx.selectedModel
})

$effect(() => {
  chat.thinkingEffort = ctx.thinkingEffort
})

$effect(() => {
  ctx.generatingConversationId = chat.isStreaming ? data.conversation.id : null
  if (!chat.isStreaming) {
    invalidateAll()
  }
})

$effect(() => {
  void chat.messages.length
  void chat.streamingText
  void chat.streamingThinking
  void chat.messageQueue.length
  if (stickToBottom) {
    scrollToBottom()
  }
})

$effect(() => {
  if (!queueMounted) return
  const key = `chat-queue-${data.conversation.id}`
  const queue = chat.messageQueue
  if (queue.length > 0) {
    localStorage.setItem(key, JSON.stringify(queue))
  } else {
    localStorage.removeItem(key)
  }
})

onMount(() => {
  const key = `chat-queue-${data.conversation.id}`
  const stored = localStorage.getItem(key)
  if (stored) {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed) && parsed.length > 0) {
      chat.messageQueue = parsed
      chat.processQueue()
    }
  }
  queueMounted = true

  const { message, images, files } = consumePendingMessage()
  if (message) {
    chat.sendMessage(data.conversation.id, message, undefined, images ?? undefined, files ?? undefined)
  }
})

const handleSubmit = (content: string, images?: import('$lib/types').ImageAttachment[], files?: import('$lib/types').FileAttachment[]) => {
  stickToBottom = true
  chat.sendMessage(data.conversation.id, content, undefined, images, files)
}

const handleRegenerate = (messageId: string) => {
  stickToBottom = true
  chat.regenerateMessage(data.conversation.id, messageId)
}

const handleEdit = (messageId: string, content: string) => {
  stickToBottom = true
  chat.editMessage(data.conversation.id, messageId, content)
}

const handleSwitchBranch = (messageId: string, direction: 'prev' | 'next') => {
  const msg = chat.messages.find(m => m.id === messageId)
  if (!msg) return

  const parentKey = msg.parentId ?? '__root__'
  const siblings = chat.allMessages.filter(m => (m.parentId ?? '__root__') === parentKey).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const currentIdx = siblings.findIndex(s => s.id === messageId)
  const newIdx = direction === 'prev' ? currentIdx - 1 : currentIdx + 1
  if (newIdx < 0 || newIdx >= siblings.length) return

  chat.switchBranch(data.conversation.id, parentKey, siblings[newIdx].id)
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
</script>

<div class="flex h-full flex-col">
  <div bind:this={messageContainer} onscroll={onScroll} class="flex-1 overflow-y-auto px-4 py-6">
    <div class="mx-auto max-w-3xl space-y-6">
      {#each chat.messages as message (message.id)}
        <ChatMessage
          {message}
          onregenerate={handleRegenerate}
          onedit={handleEdit}
          onswitchbranch={handleSwitchBranch}
        />
      {/each}
      <StreamingText
        text={chat.streamingText}
        thinking={chat.streamingThinking}
        thinkingDuration={chat.thinkingDuration}
        isThinking={chat.isThinking}
        toolCalls={chat.streamingToolCalls}
        codeExecutions={chat.streamingCodeExecutions}
      />
      {#each chat.messageQueue as entry (entry.id)}
        <div class="flex justify-end">
          <div class="flex max-w-[80%] flex-col items-end">
            {#if editingQueueId === entry.id}
              <div class="w-full min-w-[200px] rounded-2xl border border-blue-400 bg-gray-100 px-4 py-2.5 dark:border-blue-600 dark:bg-neutral-700">
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
                          <span class="max-w-[160px] truncate text-xs text-gray-600 dark:text-neutral-300">{file.filename}</span>
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

  <ChatInput
    onsubmit={handleSubmit}
    disabled={!ctx.selectedModel}
    isStreaming={chat.isStreaming}
    onstop={chat.stopStreaming}
  />
</div>
