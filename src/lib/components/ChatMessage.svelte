<script lang="ts">
import { extractCitations, filterReferencedCitations, processCitations } from '$lib/citations'
import { buildContentSegments } from '$lib/content-segments'
import { copyCodeAction } from '$lib/copy-code'
import { renderMarkdown } from '$lib/markdown'
import type { createTtsPlayer } from '$lib/stores/tts-player.svelte'
import { stripMarkdown } from '$lib/strip-markdown'
import type { Message } from '$lib/types'
import CodeExecutionBlock from './CodeExecutionBlock.svelte'
import ConfirmDialog from './ConfirmDialog.svelte'
import SourcesBlock from './SourcesBlock.svelte'
import ThinkingBlock from './ThinkingBlock.svelte'
import ToolCallBlock from './ToolCallBlock.svelte'
import { getContext } from 'svelte'

let {
  message,
  onregenerate,
  onedit,
  onswitchbranch,
}: {
  message: Message
  onregenerate?: (messageId: string) => void
  onedit?: (messageId: string, content: string) => void
  onswitchbranch?: (messageId: string, direction: 'prev' | 'next') => void
} = $props()

const tts: ReturnType<typeof createTtsPlayer> = getContext('tts-player')

let isUser = $derived(message.role === 'user')
let segments = $derived(isUser ? [] : buildContentSegments(message.content, message.toolCalls, message.codeExecutions))
let allCitations = $derived(extractCitations(message.toolCalls))
let citations = $derived(filterReferencedCitations(message.content, allCitations))

let copied = $state(false)
let confirmRegenerate = $state(false)
let isEditing = $state(false)
let editContent = $state('')
let editTextarea: HTMLTextAreaElement | undefined = $state()

let hasBranches = $derived((message.siblingCount ?? 1) > 1)

const copyMessage = () => {
  navigator.clipboard.writeText(message.content)
  copied = true
  setTimeout(() => {
    copied = false
  }, 2000)
}

const startEdit = () => {
  isEditing = true
  editContent = message.content
  import('svelte').then(({ tick }) => {
    tick().then(() => {
      if (editTextarea) {
        editTextarea.focus()
        editTextarea.style.height = 'auto'
        editTextarea.style.height = `${editTextarea.scrollHeight}px`
      }
    })
  })
}

const saveEdit = () => {
  if (editContent.trim() && editContent.trim() !== message.content) {
    onedit?.(message.id, editContent.trim())
  }
  isEditing = false
  editContent = ''
}

const cancelEdit = () => {
  isEditing = false
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

<div class="flex {isUser ? 'justify-end' : 'justify-start'}">
  {#if isUser}
    <div class="flex max-w-[80%] flex-col items-end">
      {#if isEditing}
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
            >Save & Submit</button>
          </div>
        </div>
      {:else}
        <div class="rounded-2xl bg-gray-100 px-4 py-2.5 text-gray-900 dark:bg-neutral-700 dark:text-gray-100">
          {#if message.images?.length || message.files?.length}
            <div class="mb-2 flex flex-wrap gap-2">
              {#if message.images?.length}
                {#each message.images as img (img.id)}
                  <a href="/api/uploads/{img.id}" target="_blank" rel="noopener noreferrer">
                    <img
                      src="/api/uploads/{img.id}"
                      alt="Attached"
                      class="max-h-48 max-w-xs rounded-lg object-contain"
                    />
                  </a>
                {/each}
              {/if}
              {#if message.files?.length}
                {#each message.files as file (file.id)}
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
          <div class="whitespace-pre-wrap text-sm">{message.content}</div>
        </div>
      {/if}
      <div class="mt-1 flex items-center gap-0.5">
        {#if hasBranches}
          <div class="flex items-center gap-0.5 mr-1">
            <button
              onclick={() => onswitchbranch?.(message.id, 'prev')}
              disabled={(message.siblingIndex ?? 0) === 0}
              class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default dark:text-neutral-500 dark:hover:text-neutral-300"
              aria-label="Previous version"
            >
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span class="text-xs tabular-nums text-gray-400 dark:text-neutral-500">{(message.siblingIndex ?? 0) + 1}/{message.siblingCount ?? 1}</span>
            <button
              onclick={() => onswitchbranch?.(message.id, 'next')}
              disabled={(message.siblingIndex ?? 0) >= (message.siblingCount ?? 1) - 1}
              class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default dark:text-neutral-500 dark:hover:text-neutral-300"
              aria-label="Next version"
            >
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        {/if}
        <button onclick={copyMessage} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Copy message">
          {#if copied}
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
          {:else}
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          {/if}
        </button>
        {#if !isEditing}
          <button onclick={startEdit} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Edit message">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex max-w-[90%] gap-3 min-w-0">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
        AI
      </div>
      <div class="min-w-0">
        {#if message.model}
          <div class="mb-1 text-xs font-medium text-gray-400 dark:text-neutral-500">{message.model}</div>
        {/if}
        {#if message.thinking}
          <ThinkingBlock thinking={message.thinking} duration={message.thinkingDuration} />
        {/if}
        {#each segments as segment}
          {#if segment.type === 'tool_call'}
            <ToolCallBlock toolCall={segment.toolCall} />
          {:else if segment.type === 'code_execution'}
            <CodeExecutionBlock codeExecution={segment.codeExecution} />
          {:else}
            <div class="prose prose-sm dark:prose-invert max-w-none" use:copyCodeAction>{@html processCitations(renderMarkdown(segment.content), citations)}</div>
          {/if}
        {/each}
        <SourcesBlock {citations} />
        <div class="mt-1 flex items-center gap-0.5">
          {#if hasBranches}
            <div class="flex items-center gap-0.5 mr-1">
              <button
                onclick={() => onswitchbranch?.(message.id, 'prev')}
                disabled={(message.siblingIndex ?? 0) === 0}
                class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default dark:text-neutral-500 dark:hover:text-neutral-300"
                aria-label="Previous version"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <span class="text-xs tabular-nums text-gray-400 dark:text-neutral-500">{(message.siblingIndex ?? 0) + 1}/{message.siblingCount ?? 1}</span>
              <button
                onclick={() => onswitchbranch?.(message.id, 'next')}
                disabled={(message.siblingIndex ?? 0) >= (message.siblingCount ?? 1) - 1}
                class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default dark:text-neutral-500 dark:hover:text-neutral-300"
                aria-label="Next version"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          {/if}
          <button onclick={copyMessage} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Copy message">
            {#if copied}
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            {:else}
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            {/if}
          </button>
          <button onclick={() => tts.play(stripMarkdown(message.content))} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Read aloud">
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 010 7.07" /><path d="M19.07 4.93a10 10 0 010 14.14" /></svg>
          </button>
          <button onclick={() => confirmRegenerate = true} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Regenerate message">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

{#if !isUser}
  <ConfirmDialog
    bind:open={confirmRegenerate}
    title="Regenerate response"
    description="Generate a new response for this message? The current response will still be accessible via branching."
    confirmLabel="Regenerate"
    onconfirm={() => onregenerate?.(message.id)}
  />
{/if}

<style>
  :global(.citation-ref) {
    color: #0ea5e9;
    text-decoration: none;
    font-weight: 600;
    cursor: pointer;
  }
  :global(.citation-ref:hover) {
    text-decoration: underline;
  }
  :global(.citation-ref sup) {
    font-size: 0.75em;
  }
</style>
