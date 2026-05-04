<script lang="ts">
import type { SystemPrompt } from '$lib/types'

let {
  prompts,
  selectedId = $bindable<string | null>(null),
  onchange,
}: {
  prompts: SystemPrompt[]
  selectedId: string | null
  onchange: (promptId: string | null) => void
} = $props()

let open = $state(false)

const selected = $derived(prompts.find(p => p.id === selectedId))
const label = $derived(selected?.title ?? prompts.find(p => p.isDefault)?.title ?? 'System Prompt')

const select = (id: string | null) => {
  selectedId = id
  open = false
  onchange(id)
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') open = false
}
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if prompts.length > 0}
  {#if open}
    <button class="fixed inset-0 z-40" onclick={() => open = false} tabindex="-1" aria-label="Close"></button>
  {/if}

  <div class="relative">
    <button
      onclick={() => open = !open}
      class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700 {selectedId && !selected?.isDefault ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}"
      title="System prompt: {label}"
      aria-label="System prompt: {label}"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
      <span class="max-w-[120px] truncate hidden sm:inline">{label}</span>
      <svg class="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {#if open}
      <div class="liquid-glass absolute right-0 top-full z-50 mt-1 min-w-[200px] max-w-[280px] rounded-xl py-1">
        {#each prompts as prompt (prompt.id)}
          <button
            onclick={() => select(prompt.id)}
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/10 {selectedId === prompt.id ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}"
          >
            <span class="flex-1 truncate">{prompt.title}</span>
            {#if prompt.isDefault}
              <span class="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">default</span>
            {/if}
            {#if selectedId === prompt.id}
              <svg class="h-4 w-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
