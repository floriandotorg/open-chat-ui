<script lang="ts">
import type { UserSettings } from '#lib/db-mappers.ts'
import { Mutation } from '#lib/sync/collection.svelte.ts'
import type { ModelInfo, ProviderInfo } from '#lib/types.ts'
import ApiKeyForm from './ApiKeyForm.svelte'
import { onMount } from 'svelte'

let { settings, providers, hostKey }: { settings: UserSettings | null; providers: ProviderInfo[]; hostKey: ProviderInfo | undefined } = $props()

const AGENT_PROVIDERS = new Set(['anthropic', 'openai'])

let model = $state('')
let hostUrl = $state('')
let dirty = $state(false)
let saved = $state(false)
let models = $state<ModelInfo[]>([])
let loadError = $state('')
let mutation = $state<Mutation | null>(null)
let checking = $state(false)
let connection = $state<{ ok: boolean; text: string } | null>(null)
let notificationPermission = $state<NotificationPermission | 'unsupported'>('default')
const saving = $derived(mutation?.status === 'pending')
const agentProviders = $derived(providers.filter(provider => AGENT_PROVIDERS.has(provider.id)))

$effect(() => {
  if (!dirty) {
    model = settings?.browserAgentModel ?? ''
    hostUrl = settings?.browserHostUrl ?? ''
  }
})

onMount(() => {
  notificationPermission = 'Notification' in window ? Notification.permission : 'unsupported'
  void Promise.all(
    agentProviders
      .filter(provider => provider.hasKey)
      .map(async provider => {
        const response = await fetch(`/api/models/manage?provider=${encodeURIComponent(provider.id)}`)
        if (!response.ok) {
          throw new Error('Could not load models. Try reopening this tab.')
        }
        const result: ModelInfo[] = await response.json()
        return result
      }),
  )
    .then(results => {
      models = results.flat()
    })
    .catch(error => {
      loadError = error.message
    })
})

const changed = () => {
  dirty = true
  saved = false
}

const save = async () => {
  if (saving) {
    return
  }
  mutation = new Mutation([], { silent: true })
  await mutation.run(async () => {
    const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ browserAgentModel: model || null, browserHostUrl: hostUrl.trim() || null }) })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.message ?? 'Could not save browser agent settings')
    }
    dirty = false
    saved = true
  })
}

const testConnection = async () => {
  checking = true
  connection = null
  try {
    const response = await fetch('/api/browser/health')
    const result = await response.json()
    if (result.ok) {
      const busy = result.health.busySessionId ? 'busy with a task' : 'idle'
      connection = { ok: true, text: `Connected. Chromium ${result.health.version}, ${result.health.browserRunning ? busy : 'browser starts with the first task'}.` }
    } else {
      connection = { ok: false, text: result.error ?? 'Could not reach the browser host.' }
    }
  } catch {
    connection = { ok: false, text: 'Could not reach the browser host.' }
  } finally {
    checking = false
  }
}

const enableNotifications = async () => {
  notificationPermission = await Notification.requestPermission()
}
</script>

<div class="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
  <div>
    <h3 class="text-sm font-medium">Browser Agent</h3>
    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
      Lets models hand tasks to a browser on your MacBook with your saved logins. On the MacBook, run <code>bun run browser-host:install</code> in this repository, then paste the URL and token it prints.
    </p>
  </div>

  <form onsubmit={event => { event.preventDefault(); void save() }} oninput={changed} class="space-y-3">
    <label class="block space-y-1">
      <span class="text-xs font-medium text-gray-600 dark:text-gray-300">Model that controls the browser</span>
      <select bind:value={model} onchange={changed} class="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700">
        <option value="">Off</option>
        {#if model && !models.some(entry => entry.id === model)}<option value={model}>{model}</option>{/if}
        {#each agentProviders.filter(provider => provider.hasKey) as provider (provider.id)}
          <optgroup label={provider.name}>
            {#each models.filter(entry => entry.id.startsWith(`${provider.id}/`)) as entry (entry.id)}
              <option value={entry.id}>{entry.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <span class="block text-xs text-gray-500 dark:text-gray-400">Anthropic models use the browser toolset (reads pages directly, cheaper). OpenAI models use the computer tool (screenshots only). Needs a recent computer use model.</span>
    </label>
    {#if loadError}<p role="alert" class="text-xs text-red-500">{loadError}</p>{/if}
    {#if agentProviders.every(provider => !provider.hasKey)}<p class="text-xs text-amber-600 dark:text-amber-400">Add an Anthropic or OpenAI API key first.</p>{/if}

    <label class="block space-y-1">
      <span class="text-xs font-medium text-gray-600 dark:text-gray-300">Browser host URL</span>
      <input bind:value={hostUrl} type="url" inputmode="url" placeholder="http://100.x.y.z:9330" autocomplete="off" class="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-700" />
    </label>

    <div class="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={saving || !dirty} class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" onclick={testConnection} disabled={checking || dirty || !settings?.browserHostUrl} class="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800">{checking ? 'Testing…' : 'Test connection'}</button>
      {#if saved}<span role="status" class="text-sm text-green-600">Saved</span>{/if}
      {#if mutation?.error}<span role="alert" class="text-sm text-red-500">{mutation.error}</span>{/if}
    </div>
    {#if connection}
      <p role="status" class="text-xs {connection.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">{connection.text}</p>
    {/if}
  </form>

  {#if hostKey}
    <ApiKeyForm provider={hostKey} />
  {/if}

  <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
    <span>Notify me when the browser needs a login or approval while this tab is in the background.</span>
    {#if notificationPermission === 'granted'}
      <span class="text-green-600 dark:text-green-400">Notifications on</span>
    {:else if notificationPermission === 'denied'}
      <span>Blocked in browser settings</span>
    {:else if notificationPermission === 'default'}
      <button type="button" onclick={enableNotifications} class="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">Enable notifications</button>
    {/if}
  </div>
</div>
