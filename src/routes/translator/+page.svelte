<script lang="ts">
import { resolve } from '$app/paths'
import { createTtsPlayer } from '#lib/stores/tts-player.svelte.ts'
import { type ContextNote, isSpeakerGender, isTranslationEvent, LANGUAGES, SPEAKER_GENDERS, type SpeakerGender, type TranslationNotes } from '#lib/translator.ts'
import { getTranslatorCopy } from '#lib/translator-copy.ts'
import { createTranslatorSpeech, type SpeechState } from '#lib/translator-speech.ts'
import type { PageData } from './$types'
import { onMount, untrack } from 'svelte'

let { data }: { data: PageData } = $props()
let source = $state('en')
let target = $state('th')
let contextId = $state('')
let speakerGender = $state<SpeakerGender>('unspecified')
let recipientGender = $state<SpeakerGender>('unspecified')
let text = $state('')
let additionalContext = $state('')
let translation = $state('')
let back = $state('')
let notes = $state<TranslationNotes>({ sender: [], recipient: [] })
let error = $state('')
let checkError = $state('')
let noteError = $state('')
let backComplete = $state(false)
let noteComplete = $state(false)
let speechError = $state('')
let busy = $state(false)
let checking = $state(false)
let speechState = $state<SpeechState>('idle')
let mounted = $state(false)
let copied = $state(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined
let activeTranslation: AbortController | undefined
const sourceLanguage = $derived(LANGUAGES.find(language => language.code === source) ?? LANGUAGES[1])
const targetLanguage = $derived(LANGUAGES.find(language => language.code === target) ?? LANGUAGES[3])
const sourceCopy = $derived(getTranslatorCopy(source))
const targetCopy = $derived(getTranslatorCopy(target))
const tts = createTtsPlayer(1)
const playbackActive = $derived(tts.loading || tts.playing)
const hasNotes = $derived(notes.sender.length > 0 || notes.recipient.length > 0)
const canTranslate = $derived(!busy && Boolean(text.trim()) && Boolean(data.model) && source !== target && speechState === 'idle')
let speechPrefix = ''
const speech = createTranslatorSpeech({
  text: value => {
    text = `${speechPrefix}${value}`.slice(0, 6000)
  },
  state: value => {
    speechState = value
  },
  error: value => {
    speechError = value
  },
})

onMount(() => {
  const saved = localStorage.getItem('translator-languages')?.split(',')
  if (saved && LANGUAGES.some(language => language.code === saved[0]) && LANGUAGES.some(language => language.code === saved[1]) && saved[0] !== saved[1]) {
    source = saved[0]
    target = saved[1]
  }
  const savedContext = localStorage.getItem(`translator-context:${data.userId}`)
  if (data.contexts.some(context => context.id === savedContext)) {
    contextId = savedContext ?? ''
  }
  const savedGender = localStorage.getItem(`translator-gender:${data.userId}`)
  if (isSpeakerGender(savedGender)) {
    speakerGender = savedGender
  }
  const savedRecipientGender = localStorage.getItem(`translator-recipient-gender:${data.userId}`)
  if (isSpeakerGender(savedRecipientGender)) {
    recipientGender = savedRecipientGender
  }
  mounted = true
  return () => {
    speech.dispose()
    tts.close()
    activeTranslation?.abort()
    clearTimeout(copyTimer)
  }
})

$effect(() => {
  if (!data.contexts.some(context => context.id === contextId)) {
    contextId = data.contexts[0]?.id ?? ''
  }
})

$effect(() => {
  if (mounted) {
    localStorage.setItem('translator-languages', `${source},${target}`)
    localStorage.setItem(`translator-context:${data.userId}`, contextId)
    localStorage.setItem(`translator-gender:${data.userId}`, speakerGender)
    localStorage.setItem(`translator-recipient-gender:${data.userId}`, recipientGender)
  }
})

$effect(() => {
  void text
  void source
  void target
  void contextId
  void additionalContext
  void speakerGender
  void recipientGender
  untrack(resetOutput)
})

const resetOutput = () => {
  tts.close()
  activeTranslation?.abort()
  activeTranslation = undefined
  clearTimeout(copyTimer)
  busy = false
  translation = ''
  back = ''
  notes = { sender: [], recipient: [] }
  error = ''
  checkError = ''
  noteError = ''
  backComplete = false
  noteComplete = false
  checking = false
  copied = false
}

const clear = () => {
  speech.dispose()
  speechPrefix = ''
  speechError = ''
  text = ''
  additionalContext = ''
  resetOutput()
}

const startTranslation = () => translateText(false)

const translateText = (speakImmediately: boolean) => {
  if (!canTranslate) {
    return
  }
  resetOutput()
  const controller = new AbortController()
  activeTranslation = controller
  busy = true
  void run({ text: text.trim(), source, target, contextId, additionalContext: additionalContext.trim(), speakerGender, recipientGender }, controller, speakImmediately)
}

const run = async (input: { text: string; source: string; target: string; contextId: string; additionalContext: string; speakerGender: SpeakerGender; recipientGender: SpeakerGender }, controller: AbortController, speakImmediately: boolean) => {
  try {
    const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(95_000)]) })
    if (!response.ok) {
      const result = await response.json()
      throw new Error(result.message ?? 'Translation failed')
    }
    if (!response.body) {
      throw new Error('No translation stream received')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false
    try {
      while (true) {
        const chunk = await reader.read()
        if (controller.signal.aborted) {
          return
        }
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) {
            continue
          }
          const event: unknown = JSON.parse(line)
          if (!isTranslationEvent(event)) {
            throw new Error('Invalid translation response')
          }
          if (event.type === 'translation') {
            translation += event.text
            if (speakImmediately) {
              void tts.play(translation, input.target)
            }
          } else if (event.type === 'back') {
            back = event.text
            backComplete = true
          } else if (event.type === 'notes') {
            notes = event.notes
            noteComplete = true
          } else if (event.type === 'error') {
            if (event.stage === 'translation') {
              error = event.text
            } else if (event.stage === 'back') {
              checkError = event.text
              backComplete = true
            } else {
              noteError = event.text
              noteComplete = true
            }
          } else if (event.type === 'done') {
            finished = true
          }
          checking = Boolean(translation) && !finished
        }
        if (chunk.done || finished) {
          break
        }
      }
      if (!finished && !error) {
        throw new Error('Translation connection ended early. Please try again.')
      }
    } finally {
      await reader.cancel()
    }
  } catch (cause) {
    if (!controller.signal.aborted) {
      error = cause instanceof Error ? cause.message : 'Translation failed'
    }
  } finally {
    if (!controller.signal.aborted) {
      busy = false
      checking = false
    }
  }
}

const swap = () => {
  clear()
  const previous = source
  source = target
  target = previous
  const previousGender = speakerGender
  speakerGender = recipientGender
  recipientGender = previousGender
}

const changeSource = (language: string) => {
  if (language === target) {
    swap()
    return
  }
  clear()
  source = language
}

const changeTarget = (language: string) => {
  if (language === source) {
    swap()
    return
  }
  clear()
  target = language
}

const toggleSpeech = () => {
  if (speechState !== 'idle') {
    speech.stop()
    return
  }
  tts.close()
  speechError = ''
  speechPrefix = text.trim() ? `${text.trim()} ` : ''
  void speech.start(source)
}

const copy = async () => {
  try {
    await navigator.clipboard.writeText(translation)
    copied = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied = false
    }, 2000)
  } catch {
    error = sourceCopy.copyFailed
  }
}
</script>

{#snippet noteList(title: string, entries: ContextNote[], language: string)}
  <section lang={language} class="min-w-0 rounded-3xl border border-amber-600/15 bg-amber-500/[0.03] p-5 dark:border-amber-300/15">
    <div class="mb-3 flex items-center gap-2.5">
      <svg aria-hidden="true" class="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a7 7 0 0 0-4 12.75V19h8v-3.25A7 7 0 0 0 12 3Zm-3 19h6m-5-3v-6m4 6v-6m-4 0h4" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <h2 class="text-sm font-semibold text-amber-900 dark:text-amber-100">{title}</h2>
    </div>
    <ul class="space-y-3">
      {#each entries as entry}
        <li class="min-w-0 rounded-2xl border border-amber-600/10 bg-white/60 p-4 dark:border-amber-300/10 dark:bg-white/[0.03]">
          <p class="mb-1.5 break-words text-sm font-semibold text-amber-900 dark:text-amber-100">“{entry.phrase}”</p>
          <p class="break-words text-sm leading-relaxed text-gray-700 dark:text-gray-200">{entry.note}</p>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<svelte:head><title>{sourceCopy.translator}</title><meta name="description" content="Natural translation with live speech and an independent meaning check." /></svelte:head>

<svelte:window onkeydown={event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing && !event.repeat) {
    event.preventDefault()
    startTranslation()
  }
}} />

<div lang={source} class="h-full overflow-y-auto">
  <header class="mx-auto grid max-w-5xl grid-cols-2 items-center gap-2 px-5 pb-2 pt-4 sm:flex sm:gap-3" style="padding-top: max(1rem, env(safe-area-inset-top))">
    <a href={resolve('/chat')} class="flex min-h-10 w-fit items-center gap-1.5 rounded-full px-3 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 sm:mr-auto dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white">
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m12 5-7 7 7 7M5 12h14" stroke-linecap="round" stroke-linejoin="round" /></svg>
      Chat
    </a>
    <label class="flex min-w-0 items-center gap-1.5 rounded-xl bg-gray-100/70 pl-3 sm:max-w-60 dark:bg-white/5">
      <svg aria-hidden="true" class="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3v-9.5A7.5 7.5 0 0 1 9.5 5h3a7.5 7.5 0 0 1 7.5 6.5Z" stroke-linejoin="round" /></svg>
      <select aria-label={sourceCopy.context} bind:value={contextId} class="min-h-10 min-w-0 flex-1 rounded-xl bg-transparent py-2 pr-2 text-sm">
        {#if data.contexts.length === 0}<option value="">{sourceCopy.everyday}</option>{/if}
        {#each data.contexts as context (context.id)}<option value={context.id}>{context.title}</option>{/each}
      </select>
    </label>
    <label class="flex min-w-0 items-center gap-1.5 rounded-xl bg-gray-100/70 pl-3 text-xs text-gray-500 sm:max-w-48 dark:bg-white/5 dark:text-gray-400">
      {sourceCopy.speakerGender}
      <select aria-label={sourceCopy.speakerGender} bind:value={speakerGender} class="min-h-10 min-w-0 flex-1 rounded-xl bg-transparent py-2 pr-2 text-sm text-gray-900 dark:text-gray-100">
        {#each SPEAKER_GENDERS as gender}<option value={gender}>{sourceCopy[gender]}</option>{/each}
      </select>
    </label>
    <label class="flex min-w-0 items-center gap-1.5 rounded-xl bg-gray-100/70 pl-3 text-xs text-gray-500 sm:max-w-48 dark:bg-white/5 dark:text-gray-400">
      {sourceCopy.recipientGender}
      <select aria-label={sourceCopy.recipientGender} bind:value={recipientGender} class="min-h-10 min-w-0 flex-1 rounded-xl bg-transparent py-2 pr-2 text-sm text-gray-900 dark:text-gray-100">
        {#each SPEAKER_GENDERS as gender}<option value={gender}>{sourceCopy[gender]}</option>{/each}
      </select>
    </label>
  </header>

  <main class="mx-auto max-w-5xl px-5 pb-12 pt-3">
    {#if !data.model}
      <p class="mb-6 rounded-2xl bg-emerald-500/10 p-4 text-sm"><a href="/settings?tab=translator" class="font-medium underline underline-offset-4">{sourceCopy.chooseModel}</a></p>
    {/if}

    <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 pb-4">
      <select aria-label={sourceCopy.sourceLanguage} value={source} onchange={event => { changeSource(event.currentTarget.value) }} class="min-w-0 rounded-xl border border-gray-200 bg-transparent px-3 py-3 text-sm font-medium dark:border-gray-700">
        {#each LANGUAGES as language (language.code)}<option value={language.code}>{language.label}</option>{/each}
      </select>
      <button type="button" onclick={swap} aria-label={sourceCopy.swap} class="rounded-full p-3 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-white/5">
        <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <select aria-label={sourceCopy.targetLanguage} value={target} onchange={event => { changeTarget(event.currentTarget.value) }} class="min-w-0 rounded-xl border border-gray-200 bg-transparent px-3 py-3 text-sm font-medium dark:border-gray-700">
        {#each LANGUAGES as language (language.code)}<option value={language.code}>{language.label}</option>{/each}
      </select>
    </div>

    <div class="grid items-start gap-4 md:grid-cols-2">
      <section aria-label={sourceCopy.original} class="flex min-h-44 flex-col rounded-3xl border border-gray-200 bg-gray-50/60 p-5 md:min-h-64 dark:border-gray-700 dark:bg-white/[0.02]">
        <textarea aria-label={sourceCopy.input} lang={source} inputmode="text" autocapitalize="sentences" spellcheck="true" bind:value={text} readonly={speechState !== 'idle'} maxlength="6000" placeholder={sourceCopy.inputPlaceholder} class="min-h-24 w-full flex-1 resize-y bg-transparent text-lg leading-relaxed outline-none placeholder:text-gray-400 sm:text-xl md:min-h-40"></textarea>
        <label class="mt-4 block border-t border-gray-200 pt-3 dark:border-gray-700">
          <span class="mb-2 block text-xs font-medium text-gray-500 dark:text-gray-400">{sourceCopy.messageContext}</span>
          <textarea lang={source} bind:value={additionalContext} rows="2" maxlength="2000" placeholder={sourceCopy.messageContextPlaceholder} class="w-full resize-y rounded-xl border border-gray-200 bg-white/50 px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-gray-400 focus:border-emerald-600 dark:border-gray-700 dark:bg-white/[0.03]"></textarea>
        </label>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1">
            <button type="button" onclick={toggleSpeech} disabled={speechState === 'finishing' || text.length >= 6000 && speechState === 'idle'} aria-label={speechState === 'idle' ? sourceCopy.startSpeech : sourceCopy.stopSpeech} aria-pressed={speechState === 'recording'} class="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 {speechState === 'idle' ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300' : 'bg-red-500/10 text-red-600 dark:text-red-300'}">
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></svg>
              {speechState === 'idle' ? sourceCopy.speak : speechState === 'connecting' ? sourceCopy.connecting : speechState === 'finishing' ? sourceCopy.finishing : sourceCopy.stop}
            </button>
            <button type="button" onclick={clear} disabled={!text && !additionalContext && speechState === 'idle'} class="rounded-full px-3 py-2 text-sm text-gray-400 hover:text-gray-700 disabled:invisible dark:hover:text-gray-200">{sourceCopy.clear}</button>
          </div>
          <div class="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <button type="button" onclick={startTranslation} aria-keyshortcuts="Meta+Enter Control+Enter" disabled={!canTranslate} class="flex-1 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"><span aria-live="polite">{busy ? (checking ? sourceCopy.checking : sourceCopy.translating) : sourceCopy.translate}</span></button>
            <button type="button" onclick={() => translateText(true)} disabled={!canTranslate} aria-label={sourceCopy.translateAndSpeak} title={sourceCopy.translateAndSpeak} class="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 transition hover:bg-emerald-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300">
              <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          </div>
        </div>
      </section>

      <section lang={target} aria-label={targetCopy.translation} aria-busy={busy && !translation} class="min-w-0 space-y-3">
        <div class="rounded-3xl border border-emerald-800/10 bg-emerald-600/[0.04] p-5 dark:border-emerald-300/15 dark:bg-emerald-400/[0.04]">
          <p class="mb-3 text-xs font-medium text-emerald-800/60 dark:text-emerald-200/60">{targetLanguage.label}</p>
          <div lang={target} class="whitespace-pre-wrap break-words text-xl leading-relaxed sm:text-2xl {translation ? '' : 'min-h-24'}">{#if translation}{translation}{:else}<span class="text-gray-400">{busy ? targetCopy.findingWords : targetCopy.outputPlaceholder}</span>{/if}</div>
          <div class="mt-5 flex items-center gap-2">
            <button type="button" onclick={() => { if (playbackActive) { tts.close() } else { void tts.play(translation, target) } }} disabled={!translation || speechState !== 'idle'} aria-label={playbackActive ? targetCopy.stopPlayback : targetCopy.listenTranslation} title={playbackActive ? targetCopy.stopPlayback : targetCopy.listenTranslation} aria-pressed={playbackActive} class="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300">
              {#if playbackActive}
                <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
              {:else}
                <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke-linecap="round" stroke-linejoin="round" /></svg>
              {/if}
              {playbackActive ? targetCopy.stopPlayback : targetCopy.listen}
            </button>
            <button type="button" lang={source} onclick={tts.cycleSpeed} aria-label={`${sourceCopy.playbackSpeed}: ${tts.speed}×`} title={sourceCopy.playbackSpeed} class="min-h-11 shrink-0 rounded-full px-2 text-xs font-medium tabular-nums text-emerald-700 transition hover:bg-emerald-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-emerald-300">{tts.speed}×</button>
            <button type="button" lang={source} onclick={copy} disabled={!translation} aria-label={copied ? sourceCopy.copied : sourceCopy.copy} title={copied ? sourceCopy.copied : sourceCopy.copy} class="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-emerald-700 transition hover:bg-emerald-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300">
              <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                {#if copied}<path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" />{:else}<rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" stroke-linecap="round" />{/if}
              </svg>
              <span class="sr-only" aria-live="polite">{copied ? sourceCopy.copied : sourceCopy.copy}</span>
            </button>
          </div>
          {#if tts.errorMessage}<p lang={source} role="alert" class="mt-3 text-sm text-red-500">{tts.errorMessage}</p>{/if}
        </div>
        {#if translation}
          <section lang={source} aria-labelledby="meaning-check-title" aria-busy={busy && !backComplete} class="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-white/[0.02]">
            <div class="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
              <div class="flex items-center gap-2">
                <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 10H5V6m0 4a8 8 0 1 1-1 7M8 14h8m-8 4h5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                <h2 id="meaning-check-title" class="font-medium">{sourceCopy.meaningCheck}</h2>
              </div>
              <span>{sourceLanguage.label}</span>
            </div>
            {#if back}
              <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600 dark:text-gray-300">{back}</p>
            {:else if busy && !backComplete}
              <p role="status" class="text-sm text-gray-500 dark:text-gray-400">{sourceCopy.checkingIndependently}</p>
            {/if}
            {#if checkError || (!back && !busy)}<p role="status" class="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{sourceCopy.checksFailed}</p>{/if}
          </section>
        {/if}
      </section>
    </div>

    {#if speechError}<p role="alert" class="mt-4 text-sm text-red-500">{speechError}</p>{/if}
    {#if error}<div role="alert" class="mt-4 flex items-center gap-3 text-sm text-red-500"><span>{error}</span><button type="button" onclick={startTranslation} disabled={busy || speechState !== 'idle'} class="shrink-0 underline underline-offset-4">{sourceCopy.retry}</button></div>{/if}

    {#if translation && (hasNotes || noteError || busy && !noteComplete)}
      <div aria-busy={busy && !noteComplete} class="mt-4 grid items-start gap-4 md:grid-cols-2">
        {#if notes.sender.length > 0}
          {@render noteList(sourceCopy.senderNotes, notes.sender, source)}
        {/if}
        {#if notes.recipient.length > 0}
          <div class="min-w-0 md:col-start-2">{@render noteList(targetCopy.recipientNotes, notes.recipient, target)}</div>
        {/if}
        {#if busy && !noteComplete}
          <p role="status" class="text-sm text-gray-500 md:col-span-2 dark:text-gray-400">{sourceCopy.notesPending}</p>
        {/if}
        {#if noteError}
          <div class="flex flex-wrap items-center gap-3 text-sm md:col-span-2">
            <details class="min-w-0 text-gray-500 dark:text-gray-400">
              <summary class="cursor-pointer">{sourceCopy.notesFailed}</summary>
              <p class="mt-2 max-w-prose break-words text-xs leading-relaxed">{noteError}</p>
            </details>
            <button type="button" onclick={startTranslation} disabled={busy} class="font-medium text-amber-800 underline underline-offset-4 disabled:opacity-50 dark:text-amber-200">{sourceCopy.retry}</button>
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>
