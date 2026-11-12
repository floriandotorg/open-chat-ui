<script lang="ts">
import { invalidateAll } from '$app/navigation'
import { type OpenAIConnection, parseOpenAIConnection } from '#lib/model-connection.ts'
import { createModelConnectionStore } from '#lib/sync/model-connection.svelte.ts'
import type { ProviderInfo } from '#lib/types.ts'
import ApiKeyForm from './ApiKeyForm.svelte'
import ChatGPTPlanForm from './ChatGPTPlanForm.svelte'
import { untrack } from 'svelte'

let {
  provider,
  subscriptionProvider,
  account,
  connection,
}: {
  provider: ProviderInfo
  subscriptionProvider: ProviderInfo
  account: { email?: string; name?: string } | null
  connection?: OpenAIConnection
} = $props()

const store = untrack(() => createModelConnectionStore(parseOpenAIConnection(connection)))
const options = [
  ['api', 'Use API'],
  ['subscription', 'Use subscription'],
] as const
let error = $state('')

$effect(() => {
  const next = parseOpenAIConnection(connection)
  untrack(() => store.seed(next))
})

const save = async (next: OpenAIConnection) => {
  error = (await store.save(next)) ?? ''
  if (!error) {
    await invalidateAll()
  }
}
</script>

<section class="space-y-3" aria-label="OpenAI connection">
  <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
    <h2 class="font-medium">OpenAI connection</h2>
    <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">Choose how OpenAI models are used. Each model appears once in the model picker.</p>
    <div class="mt-3 grid grid-cols-2 gap-2">
      {#each options as [id, label] (id)}
        <button type="button" onclick={() => save(id)} disabled={store.pending} aria-pressed={store.connection === id}
          class="rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-50 {store.connection === id ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-300' : 'border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800'}">{label}</button>
      {/each}
    </div>
    <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">{store.connection === 'subscription' ? 'Requires a connected ChatGPT subscription. Requests never fall back to the paid API.' : 'Requests use your OpenAI API key and are billed separately from your ChatGPT subscription.'}</p>
    {#if error}
      <p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
    {/if}
  </div>
  <ApiKeyForm {provider} />
  <ChatGPTPlanForm provider={subscriptionProvider} {account} />
</section>
