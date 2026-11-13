<script lang="ts">
import type { BrowserUserOutcome, BrowserUserRequest } from '#lib/browser-protocol.ts'
import { Mutation } from '#lib/sync/collection.svelte.ts'
import BrowserLiveView from './BrowserLiveView.svelte'

let { sessionId, request }: { sessionId: string; request: BrowserUserRequest } = $props()

let card = $state<HTMLDivElement | null>(null)
let liveViewOpen = $state(false)
let mutation = $state<Mutation | null>(null)
const busy = $derived(mutation?.status === 'pending')

const isNetwork = $derived(request.kind === 'local_network')
const isConfirm = $derived(request.kind === 'confirm' || isNetwork)
const site = $derived.by(() => {
  try {
    return new URL(request.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
})
const title = $derived(isNetwork ? 'Local network access' : request.kind === 'login' ? 'Login needed' : request.kind === 'captcha' ? 'Check needed' : 'Approval needed')

const post = (path: string, body?: unknown) => {
  mutation = new Mutation([], { silent: true })
  return mutation.run(async () => {
    const response = await fetch(`/api/browser/sessions/${encodeURIComponent(sessionId)}/${path}`, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.message ?? 'The browser did not respond')
    }
  })
}

const resume = async (outcome: BrowserUserOutcome) => {
  liveViewOpen = false
  await post('resume', { outcome, requestId: request.id })
}

$effect(() => {
  const message = request.message
  if (document.visibilityState !== 'hidden' || !('Notification' in window) || Notification.permission !== 'granted') {
    return
  }
  const notification = new Notification(title, { body: message, tag: `browser-${sessionId}` })
  notification.onclick = () => {
    window.focus()
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    notification.close()
  }
  return () => notification.close()
})
</script>

<div bind:this={card} class="my-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
  <div class="mb-1 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
    <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
    <span>{title}{site ? ` · ${site}` : ''}</span>
  </div>
  <p class="mb-3 text-amber-900/90 dark:text-amber-100/90">{request.message}</p>
  <div class="flex flex-wrap gap-2">
    {#if !isNetwork}
      <button type="button" disabled={busy} onclick={() => post('show')} class="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-500/20">
        Open on MacBook
      </button>
      <button type="button" disabled={busy} onclick={() => (liveViewOpen = true)} class="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-500/20">
        {isConfirm ? 'View browser' : 'Do it here'}
      </button>
    {/if}
    <button type="button" disabled={busy} onclick={() => resume('done')} class="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
      {isNetwork ? 'Allow for this task' : isConfirm ? 'Approve' : 'Done'}
    </button>
    <button type="button" disabled={busy} onclick={() => resume('declined')} class="rounded-lg px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-500/20">
      {isConfirm ? 'Decline' : 'Skip'}
    </button>
  </div>
  {#if mutation?.error}
    <p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{mutation.error}</p>
  {/if}
</div>

{#if liveViewOpen}
  <BrowserLiveView {sessionId} {request} onclose={() => (liveViewOpen = false)} doneLabel={isConfirm ? 'Approve' : 'Done'} ondone={() => resume('done')} />
{/if}
