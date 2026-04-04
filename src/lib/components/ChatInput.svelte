<script lang="ts">
let {
  onsubmit,
  disabled = false,
  isStreaming = false,
  onstop,
}: {
  onsubmit: (content: string) => void
  disabled?: boolean
  isStreaming?: boolean
  onstop?: () => void
} = $props()

let content = $state('')
let textarea: HTMLTextAreaElement | undefined = $state()

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

const submit = () => {
  const trimmed = content.trim()
  if (!trimmed || disabled) return
  onsubmit(trimmed)
  content = ''
  if (textarea) {
    textarea.style.height = 'auto'
  }
}

const autoResize = () => {
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
}
</script>

<div class="border-t border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
  <div class="mx-auto flex max-w-3xl items-end gap-2">
    <textarea
      bind:this={textarea}
      bind:value={content}
      onkeydown={handleKeydown}
      oninput={autoResize}
      placeholder="Type a message..."
      rows="1"
      disabled={disabled || isStreaming}
      class="flex-1 resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
    ></textarea>

    {#if isStreaming}
      <button
        onclick={onstop}
        aria-label="Stop generating"
        class="shrink-0 rounded-xl bg-red-600 p-3 text-white transition hover:bg-red-700"
      >
        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
      </button>
    {:else}
      <button
        onclick={submit}
        disabled={!content.trim() || disabled}
        aria-label="Send message"
        class="shrink-0 rounded-xl bg-blue-600 p-3 text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m-7 7l7-7 7 7" />
        </svg>
      </button>
    {/if}
  </div>
</div>
