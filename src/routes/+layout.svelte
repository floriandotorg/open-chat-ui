<script lang="ts">
import './layout.css'
import { onMount } from 'svelte'

let { children } = $props()

onMount(() => {
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'RELOAD') {
      location.reload()
    }
  })
})
</script>


<div class="h-dvh bg-white text-gray-900 dark:bg-neutral-800 dark:text-gray-100">
  {@render children()}
</div>
