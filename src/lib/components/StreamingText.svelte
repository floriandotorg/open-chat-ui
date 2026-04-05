<script lang="ts">
import { copyCodeAction } from '$lib/copy-code'
import { renderMarkdown } from '$lib/markdown'

let { text }: { text: string } = $props()

let renderedContent = $derived(renderMarkdown(text))
</script>

{#if text}
  <div class="flex justify-start">
    <div class="flex max-w-[80%] gap-3 min-w-0">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
        AI
      </div>
      <div class="prose prose-sm dark:prose-invert max-w-none min-w-0" use:copyCodeAction>
        {@html renderedContent}<span class="inline-block h-4 w-0.5 animate-pulse bg-gray-400 dark:bg-neutral-400"></span>
      </div>
    </div>
  </div>
{/if}
