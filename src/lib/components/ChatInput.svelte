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

<div class="px-4 pb-4 pt-2">
  <div class="mx-auto flex max-w-3xl items-end gap-1.5 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-neutral-600 dark:bg-neutral-700">
    <textarea
      bind:this={textarea}
      bind:value={content}
      onkeydown={handleKeydown}
      oninput={autoResize}
      placeholder="Send a Message"
      rows="1"
      disabled={disabled || isStreaming}
      class="flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-gray-400 disabled:opacity-50 dark:text-white dark:placeholder:text-neutral-400"
    ></textarea>

    <div class="flex shrink-0 items-center gap-1">
      <button
        aria-label="Dictation"
        disabled={disabled || isStreaming}
        class="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-600 dark:hover:text-white"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
        </svg>
      </button>

      {#if isStreaming}
        <button
          onclick={onstop}
          aria-label="Stop generating"
          class="rounded-full bg-gray-900 p-2 text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      {:else}
        <button
          onclick={submit}
          disabled={!content.trim() || disabled}
          aria-label="Send message"
          class="rounded-full bg-gray-900 p-2 text-white transition-colors hover:bg-gray-700 disabled:opacity-30 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>
