<script lang="ts">
import { buildContentSegments } from '$lib/content-segments'
import { copyCodeAction } from '$lib/copy-code'
import { renderMarkdown } from '$lib/markdown'
import type { CodeExecutionBlock, ToolCallInfo } from '$lib/types'
import CodeExecutionBlockComponent from './CodeExecutionBlock.svelte'
import ThinkingBlock from './ThinkingBlock.svelte'
import ToolCallBlock from './ToolCallBlock.svelte'

let {
  text,
  thinking = '',
  thinkingDuration = null,
  isThinking = false,
  toolCalls = [],
  codeExecutions = [],
}: {
  text: string
  thinking?: string
  thinkingDuration?: number | null
  isThinking?: boolean
  toolCalls?: ToolCallInfo[]
  codeExecutions?: CodeExecutionBlock[]
} = $props()

let showThinking = $derived(thinking || isThinking)
let segments = $derived(buildContentSegments(text, toolCalls, codeExecutions))
let hasContent = $derived(text || showThinking || toolCalls.length > 0 || codeExecutions.length > 0)
</script>

{#if hasContent}
  <div class="flex justify-start">
    <div class="flex max-w-[80%] gap-3 min-w-0">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
        AI
      </div>
      <div class="min-w-0">
        {#if showThinking}
          <ThinkingBlock {thinking} duration={thinkingDuration} isActive={isThinking} />
        {/if}
        {#each segments as segment, idx}
          {#if segment.type === 'tool_call'}
            <ToolCallBlock toolCall={segment.toolCall} />
          {:else if segment.type === 'code_execution'}
            <CodeExecutionBlockComponent codeExecution={segment.codeExecution} />
          {:else}
            <div class="prose prose-sm dark:prose-invert max-w-none" use:copyCodeAction>
              {@html renderMarkdown(segment.content)}{#if idx === segments.length - 1}<span class="inline-block h-4 w-0.5 animate-pulse bg-gray-400 dark:bg-neutral-400"></span>{/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  </div>
{/if}
