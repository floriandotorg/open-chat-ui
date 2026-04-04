<script lang="ts">
import './layout.css'
import favicon from '$lib/assets/favicon.svg'

let { children } = $props()
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="theme-color" content="#1e293b" />
</svelte:head>

<div class="h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
  {@render children()}
</div>
