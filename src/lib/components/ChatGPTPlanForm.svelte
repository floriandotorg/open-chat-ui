<script lang="ts">
import { replaceState } from '$app/navigation'
import { page } from '$app/state'
import type { ProviderInfo } from '#lib/types.ts'
import { onMount } from 'svelte'

type Account = { email?: string; name?: string }

let { provider, account: initialAccount }: { provider: ProviderInfo; account: Account | null } = $props()

const USAGE_URL = 'https://chatgpt.com/settings/usage'
const WELCOME_SEEN_KEY = 'chatgpt-plan-welcome-seen'
const CONNECTED_SIGNAL_KEY = 'chatgpt-plan-connected-at'
const PENDING_SIGN_IN_KEY = 'chatgpt-plan-pending-sign-in'
const PENDING_SIGN_IN_TTL_MS = 10 * 60_000

// svelte-ignore state_referenced_locally
let account = $state<Account | null>(initialAccount)
let busy = $state(false)
let error = $state('')
let notice = $state('')
let signInUrl = $state('')
let awaitingPaste = $state(false)
let callbackReachesApp = $state(false)
let linkCopied = $state(false)
let callbackUrl = $state('')
let showWelcome = $state(false)
let standalone = $state(false)

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

const readMessage = async (res: Response, fallback: string) => {
  const body: unknown = await res.json().catch(() => null)
  return isObject(body) && typeof body.message === 'string' ? body.message : fallback
}

const parseAccount = (value: unknown): Account => ({
  email: isObject(value) && typeof value.email === 'string' ? value.email : undefined,
  name: isObject(value) && typeof value.name === 'string' ? value.name : undefined,
})

const isStandaloneApp = () => window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true)

const rememberPendingSignIn = (url: string, reachesApp: boolean) => {
  localStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ url, reachesApp, expiresAt: Date.now() + PENDING_SIGN_IN_TTL_MS }))
}

const forgetPendingSignIn = () => localStorage.removeItem(PENDING_SIGN_IN_KEY)

const restorePendingSignIn = () => {
  let stored: unknown = null
  try {
    stored = JSON.parse(localStorage.getItem(PENDING_SIGN_IN_KEY) ?? 'null')
  } catch {
    stored = null
  }
  if (!isObject(stored) || typeof stored.url !== 'string' || typeof stored.expiresAt !== 'number' || stored.expiresAt < Date.now()) {
    forgetPendingSignIn()
    return
  }
  signInUrl = stored.url
  callbackReachesApp = stored.reachesApp === true
  awaitingPaste = true
}

const markConnected = (connected: Account) => {
  account = connected
  provider.hasKey = true
  awaitingPaste = false
  callbackUrl = ''
  signInUrl = ''
  forgetPendingSignIn()
  if (!localStorage.getItem(WELCOME_SEEN_KEY)) {
    showWelcome = true
  }
}

const dismissWelcome = () => {
  localStorage.setItem(WELCOME_SEEN_KEY, '1')
  showWelcome = false
}

const refreshAccount = async () => {
  const res = await fetch('/api/chatgpt')
  const body: unknown = res.ok ? await res.json() : null
  if (isObject(body) && isObject(body.account)) {
    markConnected(parseAccount(body.account))
  }
}

const onStorage = (event: StorageEvent) => {
  if (event.key === CONNECTED_SIGNAL_KEY && !account) {
    void refreshAccount()
  }
}

onMount(() => {
  window.addEventListener('storage', onStorage)
  standalone = isStandaloneApp()
  if (!account) {
    restorePendingSignIn()
  }
  const params = page.url.searchParams
  if (params.has('chatgpt') || params.has('chatgpt_error')) {
    if (params.get('chatgpt') === 'connected' && account) {
      localStorage.setItem(CONNECTED_SIGNAL_KEY, String(Date.now()))
      markConnected(account)
      window.close()
    }
    error = params.get('chatgpt_error') ?? ''
    const url = new URL(page.url.href)
    url.searchParams.delete('chatgpt')
    url.searchParams.delete('chatgpt_error')
    replaceState(url, {})
  }
  return () => window.removeEventListener('storage', onStorage)
})

const start = async () => {
  const signInTab = standalone ? null : window.open('about:blank', '_blank')
  busy = true
  error = ''
  notice = ''
  const res = await fetch('/api/chatgpt', { method: 'POST' })
  const body: unknown = res.ok ? await res.json() : null
  busy = false
  if (!isObject(body) || typeof body.url !== 'string') {
    signInTab?.close()
    error = res.ok ? 'Could not start ChatGPT sign-in' : await readMessage(res, 'Could not start ChatGPT sign-in')
    return
  }
  signInUrl = body.url
  linkCopied = false
  callbackReachesApp = body.callbackReachesApp === true
  awaitingPaste = true
  rememberPendingSignIn(signInUrl, callbackReachesApp)
  if (signInTab) {
    signInTab.opener = null
    signInTab.location.href = body.url
  }
}

const copySignInUrl = async () => {
  await navigator.clipboard.writeText(signInUrl)
  linkCopied = true
}

const pasteCallbackUrl = async () => {
  error = ''
  try {
    callbackUrl = (await navigator.clipboard.readText()).trim()
  } catch {
    error = 'Could not read the clipboard. Paste the address into the field instead.'
    return
  }
  await submitCallback()
}

const submitCallback = async () => {
  if (!callbackUrl.trim()) {
    return
  }
  busy = true
  error = ''
  const res = await fetch('/api/chatgpt/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callbackUrl }),
  })
  if (res.ok) {
    markConnected(parseAccount(await res.json()))
  } else {
    error = await readMessage(res, 'Could not connect ChatGPT')
    awaitingPaste = false
    forgetPendingSignIn()
  }
  busy = false
}

const disconnect = async () => {
  busy = true
  error = ''
  const res = await fetch('/api/chatgpt', { method: 'DELETE' })
  if (res.ok) {
    const body: unknown = await res.json()
    account = null
    provider.hasKey = false
    showWelcome = false
    notice = isObject(body) && body.revoked === true ? 'Disconnected' : 'Disconnected here. OpenAI did not confirm the revocation, so you can also remove the app in ChatGPT settings.'
  } else {
    error = await readMessage(res, 'Could not disconnect')
  }
  busy = false
}
</script>

<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
  <div class="flex items-center gap-2">
    <span class="font-medium">{provider.name}</span>
    {#if account}
      <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Connected</span>
    {:else}
      <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Not connected</span>
    {/if}
  </div>

  {#if showWelcome}
    <div class="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800/70">
      <p class="font-medium">You're using your ChatGPT plan</p>
      <p class="mt-1 text-gray-600 dark:text-gray-300">Eligible AI requests now use your ChatGPT plan. You can manage usage and set a limit for this app in ChatGPT settings.</p>
      <button type="button" onclick={dismissWelcome} class="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700">Got it</button>
    </div>
  {/if}

  {#if account}
    <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">Using ChatGPT plan{account.email ? ` as ${account.email}` : ''}.</p>
    <div class="mt-2 flex items-center gap-2">
      <a href={USAGE_URL} target="_blank" rel="noopener noreferrer" class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">Manage usage</a>
      <button
        type="button"
        onclick={disconnect}
        disabled={busy}
        class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
      >
        Disconnect
      </button>
    </div>
  {:else}
    <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">Use your ChatGPT plan instead of an API key. Eligible requests draw on your ChatGPT plan, separate from any API billing.</p>
    <button
      type="button"
      onclick={start}
      disabled={busy}
      class="mt-2 rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-200"
    >
      Continue with ChatGPT
    </button>

    {#if awaitingPaste}
      <div class="mt-3 space-y-2 text-sm">
        {#if callbackReachesApp && !standalone}
          <p class="text-gray-600 dark:text-gray-300">Approve the request in the new window. It finishes by itself.</p>
        {:else}
          <ol class="list-decimal space-y-1 pl-5 text-gray-600 dark:text-gray-300">
            <li>{standalone ? 'Open the sign-in page or copy its link into your browser' : 'Approve the request in the new window'}.</li>
            <li>After approving, a <span class="font-mono text-xs">127.0.0.1</span> page opens that won't load. That is expected.</li>
            <li>Copy that page's address. Without an address bar, copy the whole error text instead (Cmd+A, then Cmd+C on a Mac).</li>
            <li>Come back here and paste it.</li>
          </ol>
        {/if}
        {#if signInUrl}
          <div class="flex flex-wrap items-center gap-2">
            {#if standalone}
              <a
                href={signInUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="rounded-lg bg-black px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
              >
                Open sign-in page
              </a>
            {/if}
            <button
              type="button"
              onclick={copySignInUrl}
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium transition hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {linkCopied ? 'Link copied' : 'Copy sign-in link'}
            </button>
          </div>
        {/if}
        <div class="flex items-center gap-2">
          <input
            type="text"
            bind:value={callbackUrl}
            placeholder="Address or error text with code=..."
            class="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          {#if callbackUrl.trim()}
            <button
              type="button"
              onclick={submitCallback}
              disabled={busy}
              class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Connecting...' : 'Connect'}
            </button>
          {:else}
            <button
              type="button"
              onclick={pasteCallbackUrl}
              disabled={busy}
              class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Connecting...' : 'Paste and connect'}
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}

  {#if error}
    <p class="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
  {/if}
  {#if notice}
    <p class="mt-2 text-xs text-gray-500">{notice}</p>
  {/if}
</div>
