<script lang="ts">
import { createPopover, portal } from '$lib/popover.svelte'
import type { ModelInfo } from '$lib/types'

let {
  models,
  selectedModel = $bindable(''),
  onmodelchange,
}: {
  models: ModelInfo[]
  selectedModel: string
  onmodelchange?: (id: string, name: string) => void
} = $props()

const popover = createPopover()

const label = $derived(models.find(m => m.id === selectedModel)?.name ?? (selectedModel ? selectedModel : 'Select model'))

$effect(() => {
  if (models.length === 0) return
  if (selectedModel && !models.some(m => m.id === selectedModel)) {
    selectedModel = ''
    onmodelchange?.('', '')
  }
})

const select = (id: string) => {
  selectedModel = id
  const found = models.find(m => m.id === id)
  if (found) onmodelchange?.(found.id, found.name)
  popover.close()
}
</script>

<svelte:window
  onkeydown={popover.open ? popover.handleKeydown : undefined}
  onresize={popover.open ? popover.close : undefined}
  onscrollcapture={popover.open ? popover.handleScroll : undefined}
/>

<button use:portal class="fixed inset-0 z-40" class:hidden={!popover.open} onclick={popover.close} tabindex="-1" aria-label="Close"></button>

<div>
  <button
    bind:this={popover.trigger}
    onclick={popover.toggle}
    class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700 dark:text-white"
    title={label}
    aria-label="Model: {label}"
  >
    <span class="max-w-[200px] truncate">{label}</span>
    <svg class="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  <div use:portal bind:this={popover.content} style={popover.style} class="liquid-glass fixed z-50 min-w-[240px] max-w-[320px] max-h-[400px] overflow-y-auto rounded-xl py-1 text-gray-900 dark:text-gray-100" class:hidden={!popover.open}>
    {#each models as model (model.id)}
      <button
        onclick={() => select(model.id)}
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/10 {selectedModel === model.id ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}"
      >
        <span class="flex-1 truncate">{model.name}</span>
        {#if selectedModel === model.id}
          <svg class="h-4 w-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        {/if}
      </button>
    {/each}
    {#if models.length === 0}
      <div class="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No API keys configured</div>
    {/if}
  </div>
</div>
