<script lang="ts">
import type { UserSettings } from '#lib/db-mappers.ts'
import { Mutation } from '#lib/sync/collection.svelte.ts'
import { DEFAULT_CONTEXTS, type TranslationContext } from '#lib/translator.ts'
import type { ModelInfo, ProviderInfo } from '#lib/types.ts'
import { onMount } from 'svelte'

let { settings, providers }: { settings: UserSettings | null; providers: ProviderInfo[] } = $props()
let model = $state('')
let contexts = $state<TranslationContext[]>([])
let dirty = $state(false)
let saved = $state(false)
let models = $state<ModelInfo[]>([])
let loadError = $state('')
let mutation = $state<Mutation | null>(null)
const saving = $derived(mutation?.status === 'pending')

$effect(() => {
  if (!dirty) {
    model = settings?.translationModel ?? ''
    contexts = (settings?.translationContexts ?? DEFAULT_CONTEXTS).map(context => ({ ...context }))
  }
})

onMount(() => {
  void Promise.all(
    providers
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
    const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ translationModel: model || null, translationContexts: contexts }) })
    if (!response.ok) {
      const result = await response.json()
      throw new Error(result.message ?? 'Could not save translator settings')
    }
    saved = true
  })
}
</script>

<form onsubmit={event => { event.preventDefault(); void save() }} oninput={changed} class="space-y-6">
  <section class="space-y-3 rounded-2xl border border-gray-200 p-5 dark:border-gray-700">
    <h2 class="font-medium">Translation model</h2>
    <p class="text-sm text-gray-500 dark:text-gray-400">Used for translation, cultural notes, and the independent meaning check. Choose a fast model for fluent conversations.</p>
    <select aria-label="Translation model" bind:value={model} onchange={changed} class="w-full rounded-xl border border-gray-300 bg-transparent p-3 text-sm dark:border-gray-600">
      <option value="">Choose a model</option>
      {#if model && !models.some(entry => entry.id === model)}<option value={model}>{model}</option>{/if}
      {#each providers.filter(provider => provider.hasKey) as provider (provider.id)}
        <optgroup label={provider.name}>
          {#each models.filter(entry => entry.id.startsWith(`${provider.id}/`)) as entry (entry.id)}
            <option value={entry.id}>{entry.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    {#if loadError}<p role="alert" class="text-sm text-red-500">{loadError}</p>{/if}
  </section>

  <section class="space-y-4">
    <div>
      <h2 class="font-medium">Conversation contexts</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Describe the relationship, situation, and tone. These appear in the translator context menu.</p>
    </div>
    {#each contexts as context (context.id)}
      <div class="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
        <div class="flex items-center gap-3">
          <input aria-label="Context name" bind:value={context.title} required maxlength="100" placeholder="Context name" class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600" />
          <button type="button" aria-label="Remove {context.title}" onclick={() => { contexts = contexts.filter(entry => entry.id !== context.id); changed() }} class="rounded-lg px-2 py-2 text-sm text-gray-500 hover:text-red-500">Remove</button>
        </div>
        <textarea aria-label="Context description" bind:value={context.content} maxlength="4000" rows="3" placeholder="Who is speaking, to whom, and in what situation?" class="w-full resize-y rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600"></textarea>
      </div>
    {/each}
    <button type="button" disabled={contexts.length >= 20} onclick={() => { contexts = [...contexts, { id: crypto.randomUUID(), title: '', content: '' }]; changed() }} class="rounded-xl border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-600">Add context</button>
  </section>
  <p class="text-sm text-gray-500 dark:text-gray-400">Live speech uses Mistral Voxtral. Thai uses ElevenLabs Scribe automatically. Add the respective API keys under API Keys and Tools. Listening to translations uses ElevenLabs and requires an API key and Voice ID.</p>
  <div class="flex items-center gap-3">
    <button type="submit" disabled={saving} class="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
    {#if saved}<span role="status" class="text-sm text-emerald-600">Saved</span>{/if}
    {#if mutation?.error}<span role="alert" class="text-sm text-red-500">{mutation.error}</span>{/if}
  </div>
</form>
