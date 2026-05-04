<script lang="ts">
import ApiKeyForm from '$lib/components/ApiKeyForm.svelte'
import ModelManager from '$lib/components/ModelManager.svelte'
import SystemPromptManager from '$lib/components/SystemPromptManager.svelte'
import { enhance } from '$app/forms'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import { page } from '$app/state'
import type { ActionData, PageData } from './$types'

const TABS = ['keys', 'models', 'prompt', 'tools', 'account'] as const
type Tab = (typeof TABS)[number]

let { data, form }: { data: PageData; form: ActionData } = $props()
let titleModel = $state('')

const activeTab = $derived.by<Tab>(() => {
  const tab = page.url.searchParams.get('tab')
  return TABS.includes(tab as Tab) ? (tab as Tab) : 'keys'
})

const setTab = (tab: Tab) => {
  const url = new URL(page.url)
  url.searchParams.set('tab', tab)
  goto(url.toString(), { replaceState: true, keepFocus: true, noScroll: true })
}

$effect(() => {
  titleModel = data.settings?.titleModel ?? ''
})
</script>

<div class="mx-auto max-w-2xl px-4 py-8">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-bold">Settings</h1>
    <a href={resolve('/chat')} class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">
      Back to Chat
    </a>
  </div>

  <div class="liquid-glass mb-6 flex gap-1 rounded-xl p-1">
    {#each [['keys', 'API Keys'], ['models', 'Models'], ['prompt', 'System Prompt'], ['tools', 'Tools'], ['account', 'Account']] as [id, label] (id)}
      <button
        onclick={() => setTab(id as Tab)}
        class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition {activeTab === id
          ? 'bg-white/80 shadow-sm dark:bg-white/10'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
      >
        {label}
      </button>
    {/each}
  </div>

  {#if activeTab === 'keys'}
    <div class="space-y-3">
      {#each data.providers as provider (provider.id)}
        <ApiKeyForm {provider} />
      {/each}
    </div>
  {:else if activeTab === 'models'}
    <ModelManager providers={data.providers} bind:titleModel />
  {:else if activeTab === 'tools'}
    <div class="space-y-3">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Configure API keys for tools that models can use during conversations.
      </p>
      {#each data.toolServices as provider (provider.id)}
        <ApiKeyForm {provider} />
      {/each}
    </div>
  {:else if activeTab === 'prompt'}
    <SystemPromptManager initial={data.systemPrompts} />
  {:else}
    <div class="space-y-6">
      <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h3 class="mb-2 font-medium">Account Info</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">{data.user.name} ({data.user.email})</p>
      </div>

      <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h3 class="mb-3 font-medium">Change Password</h3>
        <form method="post" action="?/updatePassword" use:enhance class="space-y-3">
          <input
            type="password"
            name="currentPassword"
            placeholder="Current password"
            required
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="password"
            name="newPassword"
            placeholder="New password"
            required
            minlength="8"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <button type="submit" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Update Password
          </button>
          {#if form?.passwordError}
            <p class="text-sm text-red-500">{form.passwordError}</p>
          {/if}
          {#if form?.passwordSuccess}
            <p class="text-sm text-green-600">Password updated successfully.</p>
          {/if}
        </form>
      </div>

      <form method="post" action="?/signOut" use:enhance={() => async ({ result }) => {
        if (result.type === 'success') {
          await goto(resolve('/login'))
        }
      }}>
        <button type="submit" class="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
          Sign Out
        </button>
      </form>
    </div>
  {/if}
</div>
