<script lang="ts">
import { copyCodeAction } from '$lib/copy-code'
import { renderMarkdown } from '$lib/markdown'
import ThinkingBlock from './ThinkingBlock.svelte'

let {
  text,
  thinking = '',
  thinkingDuration = null,
  isThinking = false,
}: {
  text: string
  thinking?: string
  thinkingDuration?: number | null
  isThinking?: boolean
} = $props()

let renderedContent = $derived(renderMarkdown(text))
let showThinking = $derived(thinking || isThinking)
</script>

{#if text || showThinking}
  <div class="flex justify-start">
    <div class="flex max-w-[80%] gap-3 min-w-0">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
        AI
      </div>
      <div class="min-w-0">
        {#if showThinking}
          <ThinkingBlock {thinking} duration={thinkingDuration} isActive={isThinking} />
        {/if}
        {#if text}
          <div class="prose prose-sm dark:prose-invert max-w-none" use:copyCodeAction>
            {@html renderedContent}<span class="inline-block h-4 w-0.5 animate-pulse bg-gray-400 dark:bg-neutral-400"></span>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
