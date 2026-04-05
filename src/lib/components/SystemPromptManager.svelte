<script lang="ts">
import type { SystemPrompt } from '$lib/types'

let {
  initial,
}: {
  initial: SystemPrompt[]
} = $props()

let prompts = $state<SystemPrompt[]>([...initial])
let editingId = $state<string | null>(null)
let editTitle = $state('')
let editContent = $state('')
let saving = $state(false)

const startEdit = (prompt: SystemPrompt) => {
  editingId = prompt.id
  editTitle = prompt.title
  editContent = prompt.content
}

const cancelEdit = () => {
  editingId = null
}

const saveEdit = async () => {
  if (!editingId || saving) return
  saving = true
  const res = await fetch(`/api/system-prompts/${editingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: editTitle, content: editContent }),
  })
  if (res.ok) {
    const updated: SystemPrompt = await res.json()
    prompts = prompts.map(p => (p.id === updated.id ? updated : p))
    editingId = null
  }
  saving = false
}

const addPrompt = async () => {
  const res = await fetch('/api/system-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New Prompt', content: '' }),
  })
  if (res.ok) {
    const created: SystemPrompt = await res.json()
    prompts = [...prompts, created]
    startEdit(created)
  }
}

const setDefault = async (id: string) => {
  const res = await fetch(`/api/system-prompts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isDefault: true }),
  })
  if (res.ok) {
    prompts = prompts.map(p => ({ ...p, isDefault: p.id === id }))
  }
}

const deletePrompt = async (id: string) => {
  const res = await fetch(`/api/system-prompts/${id}`, { method: 'DELETE' })
  if (res.ok) {
    prompts = prompts.filter(p => p.id !== id)
  }
}
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <span class="block text-sm font-medium">System Prompts</span>
    <button
      onclick={addPrompt}
      class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      + Add Prompt
    </button>
  </div>

  {#if prompts.length === 0}
    <div class="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
      <p class="text-sm text-gray-500 dark:text-gray-400">No system prompts yet. Add one to get started.</p>
      <button
        onclick={addPrompt}
        class="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Create Default Prompt
      </button>
    </div>
  {:else}
    <div class="space-y-3">
      {#each prompts as prompt (prompt.id)}
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 {prompt.isDefault ? 'ring-1 ring-blue-500/30' : ''}">
          {#if editingId === prompt.id}
            <div class="space-y-3 p-4">
              <input
                type="text"
                bind:value={editTitle}
                placeholder="Prompt title"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
              <textarea
                bind:value={editContent}
                rows="5"
                placeholder="You are a helpful assistant..."
                class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              ></textarea>
              <div class="flex gap-2">
                <button
                  onclick={saveEdit}
                  disabled={saving}
                  class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onclick={cancelEdit}
                  class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          {:else}
            <div class="flex items-start justify-between gap-3 p-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-medium">{prompt.title}</h3>
                  {#if prompt.isDefault}
                    <span class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Default</span>
                  {/if}
                </div>
                <p class="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                  {prompt.content || 'No content'}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                {#if !prompt.isDefault}
                  <button
                    onclick={() => setDefault(prompt.id)}
                    title="Set as default"
                    class="rounded-lg px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    Set default
                  </button>
                {/if}
                <button
                  onclick={() => startEdit(prompt)}
                  title="Edit"
                  class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {#if !prompt.isDefault}
                  <button
                    onclick={() => deletePrompt(prompt.id)}
                    title="Delete"
                    class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
