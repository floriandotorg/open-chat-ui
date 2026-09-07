<script lang="ts">
import { loadPayload } from '$lib/stores/payloads.svelte'

let {
  messageId,
  thinking,
  duration,
  isActive = false,
}: {
  messageId: string
  thinking?: string
  duration?: number | null
  isActive?: boolean
} = $props()

let open = $state(false)
let loaded = $state<string | null>(null)
let loading = $state(false)

// While generating, thinking streams on the message itself; after finalize it
// moves to the message payload and is loaded on first expand.
const toggle = async () => {
  open = !open
  if (open && thinking === undefined && loaded === null && !loading) {
    loading = true
    loaded = (await loadPayload(messageId)).thinking
    loading = false
  }
}

let text = $derived(thinking ?? loaded ?? '')
const label = $derived(isActive ? 'Thinking…' : duration != null ? `Thought for ${duration} second${duration !== 1 ? 's' : ''}` : 'Thought')
</script>

<div class="mb-2">
  <button
    onclick={toggle}
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
      {#if loading}
        <div class="flex items-center gap-1.5 text-gray-400 dark:text-gray-500">
          <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a10 10 0 1 0 10 10" stroke-linecap="round" />
          </svg>
          Loading…
        </div>
      {:else}
        <pre class="whitespace-pre-wrap font-sans">{text}</pre>
      {/if}
    </div>
  {/if}
</div>
