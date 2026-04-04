<script lang="ts">
import type { ModelInfo, ProviderInfo } from '$lib/types'

let { providers }: { providers: ProviderInfo[] } = $props()

let selectedProvider = $state('')

$effect(() => {
  if (!selectedProvider && providers.length > 0) {
    selectedProvider = providers[0].id
  }
})
let models = $state<(ModelInfo & { enabled: boolean })[]>([])
let loading = $state(false)

const fetchModels = async (provider: string) => {
  if (!provider) {
    models = []
    return
  }
  loading = true
  const res = await fetch(`/api/models/manage?provider=${provider}`)
  if (res.ok) {
    models = await res.json()
  }
  loading = false
}

$effect(() => {
  fetchModels(selectedProvider)
})

const toggleModel = async (modelId: string, enabled: boolean) => {
  await fetch('/api/models/manage', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, enabled }),
  })
  models = models.map(m => (m.id === modelId ? { ...m, enabled } : m))
}

const toggleAll = async (enabled: boolean) => {
  await fetch('/api/models/manage', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: selectedProvider, enabled }),
  })
  models = models.map(m => ({ ...m, enabled }))
}

let enabledCount = $derived(models.filter(m => m.enabled).length)
let allEnabled = $derived(models.length > 0 && enabledCount === models.length)
let noneEnabled = $derived(enabledCount === 0)
</script>

<div class="space-y-4">
  <div class="flex items-center gap-3">
    <select
      bind:value={selectedProvider}
      class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
    >
      {#each providers as provider (provider.id)}
        <option value={provider.id}>{provider.name}</option>
      {/each}
    </select>

    <span class="text-sm text-gray-500 dark:text-gray-400">
      {enabledCount} / {models.length} enabled
    </span>
  </div>

  {#if loading}
    <div class="py-8 text-center text-sm text-gray-500">Loading models...</div>
  {:else if models.length === 0}
    <div class="py-8 text-center text-sm text-gray-500">No models available for this provider.</div>
  {:else}
    <div class="flex gap-2">
      <button
        onclick={() => toggleAll(true)}
        disabled={allEnabled}
        class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Enable All
      </button>
      <button
        onclick={() => toggleAll(false)}
        disabled={noneEnabled}
        class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Disable All
      </button>
    </div>

    <div class="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
      {#each models as model (model.id)}
        <label class="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium">{model.name}</span>
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{model.id}</span>
              <span>&middot;</span>
              <span>{(model.contextWindow / 1000).toFixed(0)}k context</span>
              {#if model.inputPricePerMToken != null}
                <span>&middot;</span>
                <span>${model.inputPricePerMToken} / ${model.outputPricePerMToken} per MT</span>
              {/if}
            </div>
            <div class="mt-1 flex gap-1">
              {#each model.capabilities as cap (cap)}
                {#if cap !== 'streaming' && cap !== 'system_prompt'}
                  <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{cap}</span>
                {/if}
              {/each}
            </div>
          </div>
          <div class="ml-4 shrink-0">
            <button
              onclick={() => toggleModel(model.id, !model.enabled)}
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {model.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'}"
              role="switch"
              aria-checked={model.enabled}
              aria-label="Toggle {model.name}"
            >
              <span
                class="inline-block h-4 w-4 rounded-full bg-white transition-transform {model.enabled ? 'translate-x-6' : 'translate-x-1'}"
              ></span>
            </button>
          </div>
        </label>
      {/each}
    </div>
  {/if}
</div>
