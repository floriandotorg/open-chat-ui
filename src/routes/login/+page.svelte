<script lang="ts">
import { enhance } from '$app/forms'
import type { ActionData } from './$types'

let { form }: { form: ActionData } = $props()
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
  <div class="w-full max-w-sm space-y-6 rounded-xl bg-white p-8 shadow-lg dark:bg-gray-900">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Open Chat UI</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to your account</p>
    </div>

    <form method="post" action="?/signInEmail" use:enhance class="space-y-4">
      <label class="block">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Email</span>
        <input
          type="email"
          name="email"
          required
          class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
      </label>

      <label class="block">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Password</span>
        <input
          type="password"
          name="password"
          required
          minlength="3"
          class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
      </label>

      <button
        type="submit"
        class="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Sign in
      </button>
    </form>

    {#if form?.message}
      <p class="text-center text-sm text-red-500">{form.message}</p>
    {/if}
  </div>
</div>
