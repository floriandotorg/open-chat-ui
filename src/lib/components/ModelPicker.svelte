<script lang="ts">
import type { ModelInfo, ProviderInfo } from '$lib/types'

let {
  providers,
  selectedModel = $bindable(''),
}: {
  providers: ProviderInfo[]
  selectedModel: string
} = $props()

let modelsByProvider = $state<Map<string, ModelInfo[]>>(new Map())

const fetchAllModels = async () => {
  const available = providers.filter(p => p.hasKey)
  const results = await Promise.all(
    available.map(async p => {
      const res = await fetch(`/api/models/${p.id}`)
      if (!res.ok) return [p.id, [] as ModelInfo[]] as const
      const models: ModelInfo[] = await res.json()
      return [p.id, models] as const
    }),
  )
  modelsByProvider = new Map(results)

  const all = results.flatMap(([, models]) => models)
  if (all.length > 0 && !all.find(m => m.id === selectedModel)) {
    selectedModel = all[0].id
  }
}

$effect(() => {
  fetchAllModels()
})

let availableProviders = $derived(providers.filter(p => p.hasKey))
</script>

<div class="relative inline-flex items-center">
  <select
    bind:value={selectedModel}
    class="cursor-pointer appearance-none bg-transparent pr-6 text-sm font-medium outline-none dark:text-white"
  >
    {#each availableProviders as provider (provider.id)}
      {@const providerModels = modelsByProvider.get(provider.id) ?? []}
      {#if providerModels.length > 0}
        <optgroup label={provider.name}>
          {#each providerModels as model (model.id)}
            <option value={model.id}>{model.name}</option>
          {/each}
        </optgroup>
      {/if}
    {/each}
    {#if availableProviders.length === 0}
      <option value="" disabled>No API keys configured</option>
    {/if}
  </select>
  <svg class="pointer-events-none absolute right-0 h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
  </svg>
</div>
