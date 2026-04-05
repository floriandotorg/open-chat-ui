<script lang="ts">
let {
  thinking,
  duration,
  isActive = false,
}: {
  thinking: string
  duration?: number | null
  isActive?: boolean
} = $props()

let open = $state(false)

const label = $derived(isActive ? 'Thinking\u2026' : duration != null ? `Thought for ${duration} second${duration !== 1 ? 's' : ''}` : 'Thought')
</script>

<div class="mb-2">
  <button
    onclick={() => open = !open}
    class="flex items-center gap-1.5 text-xs text-violet-500 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
  >
    {#if isActive}
      <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a10 10 0 1 0 10 10" stroke-linecap="round" />
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
    <div class="mt-1.5 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-gray-700 dark:border-violet-800/50 dark:bg-violet-900/20 dark:text-gray-300">
      <pre class="whitespace-pre-wrap font-sans">{thinking}</pre>
    </div>
  {/if}
</div>
