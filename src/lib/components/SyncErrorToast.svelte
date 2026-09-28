<script lang="ts">
import { onSyncError } from '$lib/sync/errors'
import { onMount } from 'svelte'
import { fly } from 'svelte/transition'

const VISIBLE_MS = 4_000

let message = $state<string | null>(null)

onMount(() => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = onSyncError(next => {
    message = next
    clearTimeout(timer)
    timer = setTimeout(() => {
      message = null
    }, VISIBLE_MS)
  })
  return () => {
    stop()
    clearTimeout(timer)
  }
})
</script>

{#if message}
  <div role="alert" class="liquid-glass fixed bottom-24 left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm text-red-600 dark:text-red-400" transition:fly={{ y: 12, duration: 180 }}>
    <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12.25a2 2 0 00-3.48 0L3.19 16a2 2 0 001.74 3z" /></svg>
    <span class="min-w-0 truncate">Change not saved: {message}</span>
  </div>
{/if}
