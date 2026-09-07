<script lang="ts">
import { renderMarkdown } from '$lib/markdown'
import { loadPayload } from '$lib/stores/payloads.svelte'
import type { MessagePayload, ToolCallSummary } from '$lib/types'

let { messageId, toolCall }: { messageId: string; toolCall: ToolCallSummary } = $props()

let open = $state(false)
let payload = $state<MessagePayload | null>(null)
let loading = $state(false)

const formatToolName = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const toggle = async () => {
  open = !open
  if (open && !payload && !loading && (toolCall.arguments === undefined || toolCall.result === undefined)) {
    loading = true
    payload = await loadPayload(messageId)
    loading = false
  }
}

let args = $derived(toolCall.arguments ?? payload?.toolResults[toolCall.id]?.arguments)
let result = $derived(toolCall.result ?? payload?.toolResults[toolCall.id]?.result)
let rawResult = $derived(toolCall.rawResult ?? payload?.toolResults[toolCall.id]?.rawResult)
let label = $derived(toolCall.done ? `Used ${formatToolName(toolCall.name)}` : `Using ${formatToolName(toolCall.name)}…`)
let renderedResult = $derived(result ? renderMarkdown(result) : '')
let renderedRawResult = $derived(rawResult ? renderMarkdown(rawResult) : '')
</script>

<div class="my-1.5">
  <button
    onclick={toggle}
    class="flex items-center gap-1.5 text-xs text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300 transition-colors"
  >
    {#if !toolCall.done}
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
      {#if loading}
        <div class="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a10 10 0 1 0 10 10" stroke-linecap="round" />
          </svg>
          Loading…
        </div>
      {:else}
        {#if args}
          <details class="mb-1">
            <summary class="cursor-pointer text-[11px] font-medium text-gray-400 dark:text-gray-500">Arguments</summary>
            <pre class="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">{JSON.stringify(args, null, 2)}</pre>
          </details>
        {/if}
        {#if rawResult}
          <details class="mb-1">
            <summary class="cursor-pointer text-[11px] font-medium text-gray-400 dark:text-gray-500">Raw output ({Math.round(rawResult.length / 1000)}k chars)</summary>
            <div class="tool-call-result mt-1 overflow-hidden wrap-break-word text-[11px] leading-relaxed">{@html renderedRawResult}</div>
          </details>
        {/if}
        {#if result}
          {#if rawResult}
            <div class="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">Summarized output</div>
          {/if}
          <div class="tool-call-result overflow-hidden wrap-break-word text-[11px] leading-relaxed">{@html renderedResult}</div>
        {/if}
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
