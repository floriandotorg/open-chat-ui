<script lang="ts">
import { renderMarkdown } from '$lib/markdown'
import type { ToolCallInfo } from '$lib/types'

let { toolCall }: { toolCall: ToolCallInfo } = $props()

let open = $state(false)

const formatToolName = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

let label = $derived(toolCall.result ? `Used ${formatToolName(toolCall.name)}` : `Using ${formatToolName(toolCall.name)}\u2026`)
let renderedResult = $derived(toolCall.result ? renderMarkdown(toolCall.result) : '')
</script>

<div class="my-1.5">
  <button
    onclick={() => open = !open}
    class="flex items-center gap-1.5 text-xs text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300 transition-colors"
  >
    {#if !toolCall.result}
      <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a10 10 0 1 0 10 10" stroke-linecap="round" />
      </svg>
    {:else}
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    {/if}
    <span>{label}</span>
    <svg
      class="h-3 w-3 transition-transform {open ? 'rotate-180' : ''}"
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>
  {#if open}
    <div class="tool-call-details mt-1 overflow-hidden rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-gray-700 dark:border-cyan-800/50 dark:bg-cyan-900/20 dark:text-gray-300">
      <details class="mb-1">
        <summary class="cursor-pointer text-[11px] font-medium text-gray-400 dark:text-gray-500">Arguments</summary>
        <pre class="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">{JSON.stringify(toolCall.arguments, null, 2)}</pre>
      </details>
      {#if toolCall.result}
        <div class="tool-call-result overflow-hidden break-words text-[11px] leading-relaxed">{@html renderedResult}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-call-result :global(ol) {
    list-style: decimal;
    padding-left: 1.25rem;
    margin: 0;
  }
  .tool-call-result :global(li) {
    margin-bottom: 0.125rem;
  }
  .tool-call-result :global(a) {
    color: inherit;
    text-decoration: none;
    font-weight: 600;
  }
  .tool-call-result :global(p) {
    margin: 0;
  }
  .tool-call-result :global(a:hover) {
    text-decoration: underline;
  }
</style>
