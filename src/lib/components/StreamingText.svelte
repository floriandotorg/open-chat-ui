<script lang="ts">
let { text }: { text: string } = $props()
</script>

{#if text}
  <div class="flex justify-start">
    <div class="max-w-[80%] rounded-2xl bg-gray-100 px-4 py-2.5 text-gray-900 dark:bg-gray-800 dark:text-gray-100">
      <div class="whitespace-pre-wrap text-sm">{text}<span class="inline-block h-4 w-0.5 animate-pulse bg-gray-400"></span></div>
    </div>
  </div>
{/if}
