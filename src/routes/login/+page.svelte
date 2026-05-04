<script lang="ts">
import { enhance } from '$app/forms'
import type { ActionData } from './$types'

let { form }: { form: ActionData } = $props()
</script>

<div class="login-bg flex min-h-screen items-center justify-center px-4">
  <div class="liquid-glass w-full max-w-sm space-y-6 rounded-2xl p-8">
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

<style>
  .login-bg {
    background:
      radial-gradient(at 20% 20%, rgba(99, 102, 241, 0.35), transparent 50%),
      radial-gradient(at 80% 0%, rgba(236, 72, 153, 0.25), transparent 50%),
      radial-gradient(at 80% 80%, rgba(14, 165, 233, 0.3), transparent 50%),
      linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  }
  @media (prefers-color-scheme: dark) {
    .login-bg {
      background:
        radial-gradient(at 20% 20%, rgba(99, 102, 241, 0.4), transparent 50%),
        radial-gradient(at 80% 0%, rgba(236, 72, 153, 0.25), transparent 50%),
        radial-gradient(at 80% 80%, rgba(14, 165, 233, 0.3), transparent 50%),
        linear-gradient(180deg, #0b0f1a 0%, #1a1530 100%);
    }
  }
</style>
