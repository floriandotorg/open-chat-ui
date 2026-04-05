<script lang="ts">
import { browser } from '$app/environment'
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
  if (browser) fetchAllModels()
})

let allModels = $derived([...modelsByProvider.values()].flat())
let currentModelInfo = $derived(allModels.find(m => m.id === selectedModel))
let availableProviders = $derived(providers.filter(p => p.hasKey))
</script>

<div class="flex items-center gap-2">
  <select
    bind:value={selectedModel}
    class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
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
