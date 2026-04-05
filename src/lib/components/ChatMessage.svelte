<script lang="ts">
import { copyCodeAction } from '$lib/copy-code'
import { renderMarkdown } from '$lib/markdown'
import type { Message } from '$lib/types'

let { message }: { message: Message } = $props()

let isUser = $derived(message.role === 'user')
let renderedContent = $derived(isUser ? '' : renderMarkdown(message.content))
</script>

<div class="flex {isUser ? 'justify-end' : 'justify-start'}">
  {#if isUser}
    <div class="max-w-[80%] rounded-2xl bg-gray-100 px-4 py-2.5 text-gray-900 dark:bg-neutral-700 dark:text-gray-100">
      <div class="whitespace-pre-wrap text-sm">{message.content}</div>
    </div>
  {:else}
    <div class="flex max-w-[80%] gap-3">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
        AI
      </div>
      <div>
        {#if message.model}
          <div class="mb-1 text-xs font-medium text-gray-400 dark:text-neutral-500">{message.model}</div>
        {/if}
        <div class="prose prose-sm dark:prose-invert max-w-none" use:copyCodeAction>{@html renderedContent}</div>
      </div>
    </div>
  {/if}
</div>
