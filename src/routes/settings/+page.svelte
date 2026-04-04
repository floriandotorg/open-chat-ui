<script lang="ts">
import ApiKeyForm from '$lib/components/ApiKeyForm.svelte'
import ModelManager from '$lib/components/ModelManager.svelte'
import SystemPromptEditor from '$lib/components/SystemPromptEditor.svelte'
import { enhance } from '$app/forms'
import { goto } from '$app/navigation'
import { resolve } from '$app/paths'
import type { ActionData, PageData } from './$types'

let { data, form }: { data: PageData; form: ActionData } = $props()
let activeTab = $state<'keys' | 'models' | 'prompt' | 'account'>('keys')
let systemPrompt = $state('')

$effect(() => {
  systemPrompt = data.settings?.defaultSystemPrompt ?? ''
})

const saveSystemPrompt = async (value: string) => {
  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultSystemPrompt: value }),
  })
}
</script>

<div class="mx-auto max-w-2xl px-4 py-8">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-bold">Settings</h1>
    <a href={resolve('/chat')} class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">
      Back to Chat
    </a>
  </div>

  <div class="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
    {#each [['keys', 'API Keys'], ['models', 'Models'], ['prompt', 'System Prompt'], ['account', 'Account']] as [id, label] (id)}
      <button
        onclick={() => activeTab = id as typeof activeTab}
        class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition {activeTab === id
          ? 'bg-white shadow dark:bg-gray-800'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}"
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
    <ModelManager providers={data.providers} />
  {:else if activeTab === 'prompt'}
    <SystemPromptEditor bind:value={systemPrompt} onsave={saveSystemPrompt} />
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
