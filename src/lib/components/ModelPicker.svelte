<script lang="ts">
import type { ModelInfo, ProviderInfo } from '$lib/types'

let {
  providers,
  selectedProvider = $bindable(''),
  selectedModel = $bindable(''),
}: {
  providers: ProviderInfo[]
  selectedProvider: string
  selectedModel: string
} = $props()

let models = $state<ModelInfo[]>([])

const fetchModels = async (provider: string) => {
  if (!provider) {
    models = []
    return
  }
  const res = await fetch(`/api/models/${provider}`)
  if (res.ok) {
    models = await res.json()
    if (models.length > 0 && !models.find(m => m.id === selectedModel)) {
      selectedModel = models[0].id
    }
  }
}

$effect(() => {
  fetchModels(selectedProvider)
})

let currentModelInfo = $derived(models.find(m => m.id === selectedModel))
let availableProviders = $derived(providers.filter(p => p.hasKey))
</script>

<div class="flex items-center gap-2">
  <select
    bind:value={selectedProvider}
    class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
  >
    {#each availableProviders as provider (provider.id)}
      <option value={provider.id}>{provider.name}</option>
    {/each}
    {#if availableProviders.length === 0}
      <option value="" disabled>No API keys configured</option>
    {/if}
  </select>

  <select
    bind:value={selectedModel}
    class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
  >
    {#each models as model (model.id)}
      <option value={model.id}>{model.name}</option>
    {/each}
  </select>

  {#if currentModelInfo}
    <div class="flex gap-1">
      {#each currentModelInfo.capabilities as cap (cap)}
        {#if cap !== 'streaming' && cap !== 'system_prompt'}
          <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{cap}</span>
        {/if}
      {/each}
    </div>
  {/if}
</div>
