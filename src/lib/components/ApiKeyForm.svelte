<script lang="ts">
import type { ApiKeySummary, ProviderInfo } from '$lib/types'

let { provider }: { provider: ProviderInfo } = $props()

let apiKey = $state('')
let saving = $state(false)
let message = $state('')

type SaveResponse = { key?: ApiKeySummary; keyCount?: number; duplicate: boolean }

const configuredLabel = $derived(provider.multiple ? `${provider.keyCount ?? 0} configured` : 'Configured')
const placeholder = $derived(provider.multiple ? 'Paste another API key...' : provider.hasKey ? 'Enter new key to update...' : 'Paste your API key...')

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

const parseKeySummary = (value: unknown): ApiKeySummary | undefined => {
  if (!isObject(value)) return undefined
  const id = value.id
  const label = value.label
  if (typeof id !== 'string' || typeof label !== 'string') return undefined
  return { id, label }
}

const parseSaveResponse = (value: unknown): SaveResponse => {
  if (!isObject(value)) return { duplicate: false }
  const key = parseKeySummary(value.key)
  const keyCount = typeof value.keyCount === 'number' ? value.keyCount : undefined
  const duplicate = value.duplicate === true
  return { key, keyCount, duplicate }
}

const setKeyCount = (count: number) => {
  provider.keyCount = count
  provider.hasKey = count > 0
}

const addKeySummary = (key: ApiKeySummary) => {
  const keys = provider.keys ?? []
  if (keys.some(existing => existing.id === key.id)) return
  provider.keys = [...keys, key]
}

const save = async () => {
  if (!apiKey.trim()) return
  saving = true
  message = ''

  const res = await fetch('/api/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: provider.id, apiKey: apiKey.trim() }),
  })

  if (res.ok) {
    const data = parseSaveResponse(await res.json())
    if (provider.multiple && data.key) {
      addKeySummary(data.key)
    }
    setKeyCount(data.keyCount ?? (provider.multiple ? (provider.keys?.length ?? 1) : 1))
    message = data.duplicate ? 'Already configured' : 'Saved'
    apiKey = ''
  } else {
    message = 'Failed to save'
  }

  saving = false
}

const remove = async (keyId?: string) => {
  const suffix = keyId ? `?keyId=${encodeURIComponent(keyId)}` : ''
  const res = await fetch(`/api/api-keys/${provider.id}${suffix}`, { method: 'DELETE' })
  if (res.ok) {
    if (keyId) {
      provider.keys = (provider.keys ?? []).filter(key => key.id !== keyId)
      setKeyCount(provider.keys.length)
    } else {
      provider.keys = []
      setKeyCount(0)
    }
    message = 'Removed'
  }
}
</script>

<div class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-800">
  <div class="flex-1">
    <div class="flex items-center gap-2">
      <span class="font-medium">{provider.name}</span>
      {#if provider.hasKey}
        <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">{configuredLabel}</span>
      {:else}
        <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Not set</span>
      {/if}
    </div>

    {#if provider.multiple && provider.keys?.length}
      <div class="mt-3 space-y-2">
        {#each provider.keys as key (key.id)}
          <div class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/70">
            <span class="font-mono text-xs text-gray-600 dark:text-gray-300">{key.label}</span>
            <button
              type="button"
              onclick={() => remove(key.id)}
              class="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Remove
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="mt-2 flex items-center gap-2">
      <input
        type="password"
        bind:value={apiKey}
        placeholder={placeholder}
        class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
      <button
        onclick={save}
        disabled={!apiKey.trim() || saving}
        class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : provider.multiple ? 'Add' : 'Save'}
      </button>
      {#if provider.hasKey && !provider.multiple}
        <button
          onclick={() => remove()}
          class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          Remove
        </button>
      {/if}
      {#if provider.multiple && (provider.keyCount ?? 0) > 1}
        <button
          onclick={() => remove()}
          class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          Remove all
        </button>
      {/if}
    </div>

    {#if provider.multiple}
      <p class="mt-1 text-xs text-gray-500">Requests rotate through configured keys and skip keys that run out of credits.</p>
    {/if}
    {#if message}
      <p class="mt-1 text-xs text-gray-500">{message}</p>
    {/if}
  </div>
</div>
