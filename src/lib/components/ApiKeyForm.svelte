<script lang="ts">
import type { ProviderInfo } from '$lib/types'

let { provider }: { provider: ProviderInfo } = $props()

let apiKey = $state('')
let saving = $state(false)
let message = $state('')

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
    message = 'Saved'
    apiKey = ''
    provider.hasKey = true
  } else {
    message = 'Failed to save'
  }

  saving = false
}

const remove = async () => {
  const res = await fetch(`/api/api-keys/${provider.id}`, { method: 'DELETE' })
  if (res.ok) {
    provider.hasKey = false
    message = 'Removed'
  }
}
</script>

<div class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-800">
  <div class="flex-1">
    <div class="flex items-center gap-2">
      <span class="font-medium">{provider.name}</span>
      {#if provider.hasKey}
        <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Configured</span>
      {:else}
        <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Not set</span>
      {/if}
    </div>

    <div class="mt-2 flex items-center gap-2">
      <input
        type="password"
        bind:value={apiKey}
        placeholder={provider.hasKey ? 'Enter new key to update...' : 'Paste your API key...'}
        class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
      <button
        onclick={save}
        disabled={!apiKey.trim() || saving}
        class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      {#if provider.hasKey}
        <button
          onclick={remove}
          class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          Remove
        </button>
      {/if}
    </div>

    {#if message}
      <p class="mt-1 text-xs text-gray-500">{message}</p>
    {/if}
  </div>
</div>
