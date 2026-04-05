<script lang="ts">
import type { Citation } from '$lib/citations'

let { citations }: { citations: Citation[] } = $props()

let open = $state(false)
let uniqueCitations = $derived(citations.filter((c, n, arr) => arr.findIndex(x => x.url === c.url) === n))
</script>

{#if uniqueCitations.length > 0}
  <div class="mt-3">
    <button
      onclick={() => (open = !open)}
      class="flex cursor-pointer items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      aria-label="Toggle sources"
    >
      <div class="flex -space-x-1.5">
        {#each uniqueCitations.slice(0, 5) as citation (citation.url)}
          <img
            src="https://www.google.com/s2/favicons?domain={citation.hostname}&sz=32"
            alt=""
            class="h-4 w-4 rounded-full ring-2 ring-white dark:ring-neutral-800"
            loading="lazy"
          />
        {/each}
      </div>
      <span class="font-medium">{uniqueCitations.length} Sources</span>
      <svg
        class="h-3 w-3 transition-transform {open ? 'rotate-180' : ''}"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    {#if open}
      <div class="mt-1.5 rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
        {#each uniqueCitations as citation, n (citation.url)}
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 rounded px-2 py-1.5 text-gray-600 transition-colors hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            <span class="w-4 shrink-0 text-right text-gray-400 dark:text-neutral-500">{citation.index}</span>
            <img
              src="https://www.google.com/s2/favicons?domain={citation.hostname}&sz=16"
              alt=""
              class="h-3.5 w-3.5 shrink-0"
              loading="lazy"
            />
            <span class="truncate">{citation.url}</span>
          </a>
        {/each}
      </div>
    {/if}
  </div>
{/if}
