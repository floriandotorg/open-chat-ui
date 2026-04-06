<script lang="ts">
import './layout.css'
import { invalidateAll } from '$app/navigation'
import { onMount } from 'svelte'

let { children } = $props()

onMount(() => {
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'RELOAD') {
      location.reload()
    }
  })

  let lastRefresh = Date.now()
  const MIN_INTERVAL = 3000

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRefresh > MIN_INTERVAL) {
      lastRefresh = Date.now()
      invalidateAll()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>


<div class="h-dvh bg-white text-gray-900 dark:bg-neutral-800 dark:text-gray-100">
  {@render children()}
</div>
