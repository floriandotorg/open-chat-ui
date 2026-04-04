<script lang="ts">
let {
  value = $bindable(''),
  onsave,
}: {
  value: string
  onsave: (value: string) => void
} = $props()

let saving = $state(false)

const save = async () => {
  saving = true
  onsave(value)
  saving = false
}
</script>

<div class="space-y-3">
  <label for="system-prompt" class="block text-sm font-medium">Default System Prompt</label>
  <textarea
    id="system-prompt"
    bind:value
    rows="6"
    placeholder="You are a helpful assistant..."
    class="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
  ></textarea>
  <button
    onclick={save}
    disabled={saving}
    class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
  >
    {saving ? 'Saving...' : 'Save'}
  </button>
</div>
