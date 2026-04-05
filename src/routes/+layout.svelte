<script lang="ts">
import './layout.css'
let { children } = $props()
</script>


<div class="h-screen bg-white text-gray-900 dark:bg-neutral-800 dark:text-gray-100">
  {@render children()}
</div>
