<script lang="ts">
import { extractCitations, filterReferencedCitations, processCitations } from '$lib/citations'
import { buildContentSegments } from '$lib/content-segments'
import { copyCodeAction } from '$lib/copy-code'
import { renderMarkdown } from '$lib/markdown'
import type { Message } from '$lib/types'
import CodeExecutionBlock from './CodeExecutionBlock.svelte'
import SourcesBlock from './SourcesBlock.svelte'
import ThinkingBlock from './ThinkingBlock.svelte'
import ToolCallBlock from './ToolCallBlock.svelte'

let { message }: { message: Message } = $props()

let isUser = $derived(message.role === 'user')
let segments = $derived(isUser ? [] : buildContentSegments(message.content, message.toolCalls, message.codeExecutions))
let allCitations = $derived(extractCitations(message.toolCalls))
let citations = $derived(filterReferencedCitations(message.content, allCitations))

let copied = $state(false)

const copyMessage = () => {
  navigator.clipboard.writeText(message.content)
  copied = true
  setTimeout(() => {
    copied = false
  }, 2000)
}

const editMessage = () => {}
const regenerateMessage = () => {}
</script>

<div class="flex {isUser ? 'justify-end' : 'justify-start'}">
  {#if isUser}
    <div class="flex max-w-[80%] flex-col items-end">
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
      <div class="mt-1 flex gap-0.5">
        <button onclick={copyMessage} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Copy message">
          {#if copied}
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
          {:else}
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          {/if}
        </button>
        <button onclick={editMessage} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Edit message">
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
      </div>
    </div>
  {:else}
    <div class="flex max-w-[80%] gap-3 min-w-0">
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
        <div class="mt-1 flex gap-0.5">
          <button onclick={copyMessage} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Copy message">
            {#if copied}
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            {:else}
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            {/if}
          </button>
          <button onclick={regenerateMessage} class="cursor-pointer rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-neutral-500 dark:hover:text-neutral-300" aria-label="Regenerate message">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

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
