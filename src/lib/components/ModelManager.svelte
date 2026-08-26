<script lang="ts">
import { pbClient } from '$lib/pb-client'
import { createRealtimeSlot, registerRealtime } from '$lib/realtime-watchdog'
import type { ModelInfo, ProviderInfo } from '$lib/types'
import { browser } from '$app/environment'
import { onMount } from 'svelte'

let {
  providers,
  titleModel,
  savingTitleModel,
  onSaveTitleModel,
  summarizerModel,
  savingSummarizerModel,
  onSaveSummarizerModel,
}: {
  providers: ProviderInfo[]
  titleModel: string
  savingTitleModel: boolean
  onSaveTitleModel: (value: string) => void
  summarizerModel: string
  savingSummarizerModel: boolean
  onSaveSummarizerModel: (value: string) => void
} = $props()

let selectedProvider = $state('')
let allModelsByProvider = $state<Map<string, ModelInfo[]>>(new Map())

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

const fetchAllModels = async () => {
  const available = providers.filter(p => p.hasKey)
  const results = await Promise.all(
    available.map(async p => {
      const res = await fetch(`/api/models/manage?provider=${p.id}`)
      if (!res.ok) return [p.id, [] as ModelInfo[]] as const
      const m: ModelInfo[] = await res.json()
      return [p.id, m] as const
    }),
  )
  allModelsByProvider = new Map(results)
}

$effect(() => {
  if (browser) fetchModels(selectedProvider)
})

$effect(() => {
  if (browser) fetchAllModels()
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

let isCustomProvider = $derived(providers.find(p => p.id === selectedProvider)?.supportsCustomModels ?? false)

let searchQuery = $state('')
let searchResults = $state<ModelInfo[]>([])
let searching = $state(false)
let adding = $state(false)

$effect(() => {
  if (!browser || !isCustomProvider) return
  const q = searchQuery.trim()
  if (!q) {
    searchResults = []
    searching = false
    return
  }
  searching = true
  const timer = setTimeout(async () => {
    const res = await fetch(`/api/models/search?provider=${selectedProvider}&q=${encodeURIComponent(q)}`)
    if (res.ok) {
      searchResults = await res.json()
    }
    searching = false
  }, 250)
  return () => clearTimeout(timer)
})

const addModel = async (modelId: string) => {
  if (!modelId.trim() || adding) return
  adding = true
  await fetch('/api/models/manage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: selectedProvider, modelId: modelId.trim() }),
  })
  searchQuery = ''
  searchResults = []
  adding = false
  await fetchModels(selectedProvider)
  await fetchAllModels()
}

const removeModel = async (modelId: string) => {
  await fetch('/api/models/manage', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId }),
  })
  await fetchModels(selectedProvider)
  await fetchAllModels()
}

let searchHasExactMatch = $derived(searchResults.some(m => m.id === `${selectedProvider}/${searchQuery.trim()}`))
let addedIds = $derived(new Set(models.map(m => m.id)))

let enabledCount = $derived(models.filter(m => m.enabled).length)
let allEnabled = $derived(models.length > 0 && enabledCount === models.length)
let noneEnabled = $derived(enabledCount === 0)
let availableProviders = $derived(providers.filter(p => p.hasKey))

const refetchProviderModels = async (provider: string) => {
  if (!provider) return
  const res = await fetch(`/api/models/manage?provider=${provider}`)
  if (!res.ok) return
  const m = await res.json()
  if (provider === selectedProvider) models = m
  if (allModelsByProvider.has(provider)) {
    const next = new Map(allModelsByProvider)
    next.set(provider, m)
    allModelsByProvider = next
  }
}

onMount(() => {
  if (!browser) return
  const slot = createRealtimeSlot(
    () =>
      pbClient.collection('provider_models').subscribe('*', e => {
        const provider = e.record.provider as string
        void refetchProviderModels(provider)
      }),
    () => refetchProviderModels(selectedProvider),
  )
  void slot.subscribe()
  const deregister = registerRealtime(slot)
  return () => {
    deregister()
    slot.cancel()
  }
})
</script>

<div class="space-y-6">
  <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
    <h3 class="mb-1 text-sm font-medium">Title Generation Model</h3>
    <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">Model used to auto-generate chat titles after the first reply.</p>
    <select
      value={titleModel}
    onchange={(e) => onSaveTitleModel(e.currentTarget.value)}
      disabled={savingTitleModel}
      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
    >
      <option value="">Disabled</option>
      {#each availableProviders as provider (provider.id)}
        {@const providerModels = allModelsByProvider.get(provider.id) ?? []}
        {#if providerModels.length > 0}
          <optgroup label={provider.name}>
            {#each providerModels as model (model.id)}
              <option value={model.id}>{model.name}</option>
            {/each}
          </optgroup>
        {/if}
      {/each}
    </select>
  </div>

  <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
    <h3 class="mb-1 text-sm font-medium">Search Result Summarizer</h3>
    <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
      Model used to filter and condense search tool results (web, news, Reddit, academic) against the research question before they enter the conversation. Saves context tokens. Disabled returns raw results.
    </p>
    <select
      value={summarizerModel}
      onchange={(e) => onSaveSummarizerModel(e.currentTarget.value)}
      disabled={savingSummarizerModel}
      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
    >
      <option value="">Disabled</option>
      {#each availableProviders as provider (provider.id)}
        {@const providerModels = allModelsByProvider.get(provider.id) ?? []}
        {#if providerModels.length > 0}
          <optgroup label={provider.name}>
            {#each providerModels as model (model.id)}
              <option value={model.id}>{model.name}</option>
            {/each}
          </optgroup>
        {/if}
      {/each}
    </select>
  </div>

  <hr class="border-gray-200 dark:border-gray-800" />

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
      {models.length - enabledCount} / {models.length} hidden
    </span>
  </div>

  {#if isCustomProvider}
    <div class="relative">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search models to add, e.g. moonshotai/kimi-k3"
        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
      {#if searchQuery.trim()}
        <div class="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {#each searchResults as result (result.id)}
            <div class="flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
              <div class="flex min-w-0 flex-col">
                <span class="truncate text-sm font-medium">{result.name}</span>
                <span class="truncate text-xs text-gray-500 dark:text-gray-400">
                  {result.id} &middot; {(result.contextWindow / 1000).toFixed(0)}k context
                  {#if result.inputPricePerMToken != null}
                    &middot; ${result.inputPricePerMToken} / ${result.outputPricePerMToken} per MT
                  {/if}
                </span>
              </div>
              {#if addedIds.has(result.id)}
                <span class="shrink-0 text-xs text-gray-400">Added</span>
              {:else}
                <button
                  onclick={() => addModel(result.id.slice(result.id.indexOf('/') + 1))}
                  disabled={adding}
                  class="shrink-0 rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Add
                </button>
              {/if}
            </div>
          {/each}
          {#if !searchHasExactMatch}
            <button
              onclick={() => addModel(searchQuery.trim())}
              disabled={adding}
              class="w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-gray-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-gray-800"
            >
              Add "{searchQuery.trim()}" by id
            </button>
          {/if}
          {#if searching}
            <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Searching...</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="py-8 text-center text-sm text-gray-500">Loading models...</div>
  {:else if models.length === 0}
    <div class="py-8 text-center text-sm text-gray-500">
      {isCustomProvider ? 'No models added yet. Search above to add one.' : 'No models available for this provider.'}
    </div>
  {:else}
    <div class="flex gap-2">
      <button
        onclick={() => toggleAll(false)}
        disabled={noneEnabled}
        class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Hide All
      </button>
      <button
        onclick={() => toggleAll(true)}
        disabled={allEnabled}
        class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Show All
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
          <div class="ml-4 flex shrink-0 items-center gap-2">
            <span class="text-xs text-gray-400">{model.enabled ? '' : 'hidden'}</span>
            {#if isCustomProvider}
              <button
                onclick={() => removeModel(model.id)}
                class="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                aria-label="Remove {model.name}"
              >
                Remove
              </button>
            {/if}
            <button
              onclick={() => toggleModel(model.id, !model.enabled)}
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {model.enabled ? 'bg-gray-300 dark:bg-gray-700' : 'bg-orange-500'}"
              role="switch"
              aria-checked={!model.enabled}
              aria-label="Hide {model.name}"
            >
              <span
                class="inline-block h-4 w-4 rounded-full bg-white transition-transform {model.enabled ? 'translate-x-1' : 'translate-x-6'}"
              ></span>
            </button>
          </div>
        </label>
      {/each}
    </div>
  {/if}
  </div>
</div>
