<script lang="ts">
import type { ModelInfo, ProviderInfo } from '$lib/types'

let {
  providers,
  selectedModel = $bindable(''),
}: {
  providers: ProviderInfo[]
  selectedModel: string
} = $props()

let models = $state<ModelInfo[]>([])
let open = $state(false)

const fetchAllModels = async () => {
  const available = providers.filter(p => p.hasKey)
  const results = await Promise.all(
    available.map(async p => {
      const res = await fetch(`/api/models/${p.id}`)
      if (!res.ok) return [] as ModelInfo[]
      return (await res.json()) as ModelInfo[]
    }),
  )
  models = results.flat()

  if (models.length > 0 && !models.find(m => m.id === selectedModel)) {
    selectedModel = models[0].id
  }
}

$effect(() => {
  fetchAllModels()
})

const selected = $derived(models.find(m => m.id === selectedModel))
const label = $derived(selected?.name ?? 'Select model')

const select = (id: string) => {
  selectedModel = id
  open = false
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') open = false
}
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
  <button class="fixed inset-0 z-40" onclick={() => open = false} tabindex="-1" aria-label="Close"></button>
{/if}

<div class="relative">
  <button
    onclick={() => open = !open}
    class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700 dark:text-white"
    title={label}
    aria-label="Model: {label}"
  >
    <span class="max-w-[200px] truncate">{label}</span>
    <svg class="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if open}
    <div class="absolute left-0 top-full z-50 mt-1 min-w-[240px] max-w-[320px] max-h-[400px] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
      {#each models as model (model.id)}
        <button
          onclick={() => select(model.id)}
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-neutral-700 {selectedModel === model.id ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}"
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
  {/if}
</div>
