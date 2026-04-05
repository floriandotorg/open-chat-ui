<script lang="ts">
import { THINKING_EFFORT_LABELS, type ThinkingEffort } from '$lib/types'

let {
  thinkingEffort = $bindable('none'),
}: {
  thinkingEffort: ThinkingEffort
} = $props()

const efforts: ThinkingEffort[] = ['none', 'low', 'medium', 'high', 'max']

let open = $state(false)

const toggle = () => {
  open = !open
}

const select = (effort: ThinkingEffort) => {
  thinkingEffort = effort
  open = false
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') open = false
}

const barCount = (effort: ThinkingEffort): number => ({ none: 0, low: 1, medium: 2, high: 3, max: 4 })[effort]
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
  <button class="fixed inset-0 z-40" onclick={() => open = false} tabindex="-1" aria-label="Close"></button>
{/if}

<div class="relative">
  <button
    onclick={toggle}
    class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700"
    aria-label="Thinking effort: {THINKING_EFFORT_LABELS[thinkingEffort]}"
    title="Thinking effort"
  >
    <svg class="h-4 w-4 {thinkingEffort === 'none' ? 'text-gray-400' : 'text-violet-500'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
      <path d="M9 21h6" />
      <path d="M10 21v1a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1" />
    </svg>
    <div class="flex items-end gap-0.5">
      {#each { length: 4 } as _, n (n)}
        <div
          class="w-[3px] rounded-sm transition-colors {n < barCount(thinkingEffort) ? 'bg-violet-500' : 'bg-gray-300 dark:bg-neutral-600'}"
          style="height: {4 + (n + 1) * 3}px"
        ></div>
      {/each}
    </div>
  </button>

  {#if open}
    <div class="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
      {#each efforts as effort (effort)}
        <button
          onclick={() => select(effort)}
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700 {thinkingEffort === effort ? 'text-violet-600 dark:text-violet-400 font-medium' : ''}"
        >
          <div class="flex items-end gap-0.5 w-5">
            {#each { length: 4 } as _, n (n)}
              <div
                class="w-[3px] rounded-sm {n < barCount(effort) ? 'bg-violet-500' : 'bg-gray-300 dark:bg-neutral-600'}"
                style="height: {4 + (n + 1) * 3}px"
              ></div>
            {/each}
          </div>
          {THINKING_EFFORT_LABELS[effort]}
        </button>
      {/each}
    </div>
  {/if}
</div>
