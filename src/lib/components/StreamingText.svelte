<script lang="ts">
let { text }: { text: string } = $props()
</script>

{#if text}
  <div class="flex justify-start">
    <div class="flex max-w-[80%] gap-3">
      <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
        AI
      </div>
      <div class="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100">
        {text}<span class="inline-block h-4 w-0.5 animate-pulse bg-gray-400 dark:bg-neutral-400"></span>
      </div>
    </div>
  </div>
{/if}
