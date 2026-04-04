<script lang="ts">
import type { Message } from '$lib/types'

let { message }: { message: Message } = $props()

let isUser = $derived(message.role === 'user')
</script>

<div class="flex {isUser ? 'justify-end' : 'justify-start'}">
  <div class="max-w-[80%] rounded-2xl px-4 py-2.5 {isUser
    ? 'bg-blue-600 text-white'
    : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'}">
    <div class="whitespace-pre-wrap text-sm">{message.content}</div>
    {#if !isUser && message.model}
      <div class="mt-1 text-xs opacity-50">{message.provider}/{message.model}</div>
    {/if}
  </div>
</div>
