<script lang="ts">
import type { BrowserLiveInput, BrowserUserRequest } from '#lib/browser-protocol.ts'
import { onMount } from 'svelte'

let { sessionId, request, doneLabel, onclose, ondone }: { sessionId: string; request: BrowserUserRequest; doneLabel: string; onclose: () => void; ondone: () => void } = $props()

const FRAME_INTERVAL_MS = 250
const AFTER_INPUT_REFRESH_MS = 120
const WHEEL_FLUSH_MS = 80
// Soft keyboards often report Backspace as "Unidentified", so a sentinel
// character lets an empty field still produce a deletion input event.
const SENTINEL = '\u200B'
const SPECIAL_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

let frameUrl = $state<string | null>(null)
let image = $state<HTMLImageElement | null>(null)
let keyboard = $state<HTMLInputElement | null>(null)
let loadError = $state('')
let inputError = $state('')
let wakeFrameLoop: (() => void) | null = null
let pendingWheel: { x: number; y: number; deltaX: number; deltaY: number } | null = null
let wheelTimer: ReturnType<typeof setTimeout> | null = null

const base = $derived(`/api/browser/sessions/${encodeURIComponent(sessionId)}`)
const site = $derived.by(() => {
  try {
    return new URL(request.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
})

const send = async (input: BrowserLiveInput) => {
  try {
    const response = await fetch(`${base}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    inputError = response.ok ? '' : 'The browser did not accept the input.'
  } catch {
    inputError = 'The browser did not accept the input.'
  }
  setTimeout(() => wakeFrameLoop?.(), AFTER_INPUT_REFRESH_MS)
}

const toPagePoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
  if (!image?.naturalWidth || !image.naturalHeight) {
    return null
  }
  const rect = image.getBoundingClientRect()
  const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
  const x = (clientX - rect.left - (rect.width - image.naturalWidth * scale) / 2) / scale
  const y = (clientY - rect.top - (rect.height - image.naturalHeight * scale) / 2) / scale
  if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) {
    return null
  }
  return { x: Math.round(x), y: Math.round(y) }
}

const tap = (event: MouseEvent) => {
  const point = toPagePoint(event.clientX, event.clientY)
  if (point) {
    void send({ type: 'tap', ...point })
  }
  keyboard?.focus({ preventScroll: true })
}

const wheel = (event: WheelEvent) => {
  event.preventDefault()
  const point = toPagePoint(event.clientX, event.clientY)
  if (!point) {
    return
  }
  pendingWheel = { ...point, deltaX: (pendingWheel?.deltaX ?? 0) + event.deltaX, deltaY: (pendingWheel?.deltaY ?? 0) + event.deltaY }
  wheelTimer ??= setTimeout(() => {
    wheelTimer = null
    if (pendingWheel) {
      void send({ type: 'wheel', ...pendingWheel })
      pendingWheel = null
    }
  }, WHEEL_FLUSH_MS)
}

const keydown = (event: KeyboardEvent) => {
  if (SPECIAL_KEYS.has(event.key)) {
    event.preventDefault()
    void send({ type: 'key', key: event.key })
  }
}

const typed = (event: Event & { currentTarget: HTMLInputElement }) => {
  const value = event.currentTarget.value
  if (value.length < SENTINEL.length) {
    void send({ type: 'key', key: 'Backspace' })
  } else {
    const text = value.replaceAll(SENTINEL, '')
    if (text) {
      void send({ type: 'text', text })
    }
  }
  event.currentTarget.value = SENTINEL
  event.currentTarget.setSelectionRange(SENTINEL.length, SENTINEL.length)
}

const caretToEnd = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
  event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)
}

onMount(() => {
  let stopped = false
  let currentUrl: string | null = null
  const loop = async () => {
    while (!stopped) {
      try {
        const response = await fetch(`${base}/frame`, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('frame failed')
        }
        const blob = await response.blob()
        if (stopped) {
          return
        }
        const next = URL.createObjectURL(blob)
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl)
        }
        currentUrl = next
        frameUrl = next
        loadError = ''
      } catch {
        loadError = 'Could not load the browser view. Is the MacBook awake?'
      }
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, FRAME_INTERVAL_MS)
        wakeFrameLoop = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
  }
  void loop()
  return () => {
    stopped = true
    wakeFrameLoop?.()
    if (wheelTimer) {
      clearTimeout(wheelTimer)
    }
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl)
    }
  }
})
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-gray-950/95 text-white" role="dialog" aria-modal="true" aria-label="Browser on your MacBook">
  <header class="flex items-center gap-3 border-b border-white/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{request.message}</p>
      {#if site}<p class="truncate text-xs text-white/60">{site}</p>{/if}
    </div>
    <button type="button" onclick={ondone} class="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium hover:bg-amber-700">{doneLabel}</button>
    <button type="button" onclick={onclose} class="rounded-lg px-3 py-1.5 text-sm text-white/80 hover:bg-white/10">Close</button>
  </header>

  <button type="button" onclick={tap} onwheel={wheel} aria-label="Browser view. Tap to click." class="relative min-h-0 flex-1 cursor-pointer p-2">
    {#if frameUrl}
      <img bind:this={image} src={frameUrl} alt="Current browser page" draggable="false" class="h-full w-full select-none object-contain" />
    {:else if !loadError}
      <span class="text-sm text-white/60">Connecting to the browser…</span>
    {/if}
    {#if loadError}
      <span class="absolute inset-x-0 top-4 mx-auto w-fit rounded-lg bg-red-600/90 px-3 py-1.5 text-xs">{loadError}</span>
    {/if}
  </button>

  <footer class="border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
    <p class="mb-1 text-xs text-white/60">Keyboard: tap a field above, then type here. Enter, Tab and arrow keys are passed through.</p>
    <input
      bind:this={keyboard}
      value={SENTINEL}
      oninput={typed}
      onkeydown={keydown}
      onfocus={caretToEnd}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      aria-label="Type into the browser"
      class="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-amber-400 focus:outline-none"
    />
    {#if inputError}<p role="alert" class="mt-1 text-xs text-red-400">{inputError}</p>{/if}
  </footer>
</div>
