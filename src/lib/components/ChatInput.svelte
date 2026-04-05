<script lang="ts">
import type { FileAttachment, ImageAttachment } from '$lib/types'
import { page } from '$app/state'
import { tick } from 'svelte'

let {
  onsubmit,
  disabled = false,
  isStreaming = false,
  onstop,
}: {
  onsubmit: (content: string, images?: ImageAttachment[], files?: FileAttachment[]) => void
  disabled?: boolean
  isStreaming?: boolean
  onstop?: () => void
} = $props()

let content = $state('')
let textarea: HTMLTextAreaElement | undefined = $state()
let fileInput: HTMLInputElement | undefined = $state()
let dictationState = $state<'idle' | 'recording' | 'transcribing'>('idle')
let recordingSeconds = $state(0)
let waveformBars = $state<number[]>([])
let mediaRecorder: MediaRecorder | undefined
let audioChunks: Blob[] = []
let analyser: AnalyserNode | undefined
let audioContext: AudioContext | undefined
let animationFrame: number | undefined
let timerInterval: ReturnType<typeof setInterval> | undefined
let isDragging = $state(false)

interface PendingImage {
  attachment: ImageAttachment
  previewUrl: string
}

const FILE_MIME_TYPES = new Set(['text/csv'])

let pendingImages = $state<PendingImage[]>([])
let pendingFiles = $state<FileAttachment[]>([])
let uploadingCount = $state(0)

const formattedTime = $derived(() => {
  const m = Math.floor(recordingSeconds / 60)
  const s = recordingSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const isAcceptedFile = (file: File) => file.type.startsWith('image/') || FILE_MIME_TYPES.has(file.type)

const uploadFile = async (file: File) => {
  if (!isAcceptedFile(file)) return
  ++uploadingCount
  const isImage = file.type.startsWith('image/')
  const previewUrl = isImage ? URL.createObjectURL(file) : ''
  const formData = new FormData()
  formData.append('file', file)
  try {
    const res = await fetch('/api/uploads', { method: 'POST', body: formData })
    if (!res.ok) {
      if (isImage) URL.revokeObjectURL(previewUrl)
      const err = await res.json().catch(() => ({ message: 'Upload failed' }))
      console.error('Upload error:', err.message ?? err)
      return
    }
    const data: { id: string; filename: string; mimeType: string } = await res.json()
    if (isImage) {
      pendingImages = [...pendingImages, { attachment: { id: data.id, mimeType: data.mimeType }, previewUrl }]
    } else {
      pendingFiles = [...pendingFiles, { id: data.id, filename: data.filename, mimeType: data.mimeType }]
    }
  } catch (err) {
    if (isImage) URL.revokeObjectURL(previewUrl)
    console.error('Upload error:', err)
  } finally {
    --uploadingCount
  }
}

const removeImage = (idx: number) => {
  const removed = pendingImages[idx]
  if (removed) URL.revokeObjectURL(removed.previewUrl)
  pendingImages = pendingImages.filter((_, n) => n !== idx)
}

const removeFile = (idx: number) => {
  pendingFiles = pendingFiles.filter((_, n) => n !== idx)
}

const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (let n = 0; n < items.length; ++n) {
    if (items[n].type.startsWith('image/')) {
      e.preventDefault()
      const file = items[n].getAsFile()
      if (file) uploadFile(file)
    }
  }
}

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  isDragging = false
  const files = e.dataTransfer?.files
  if (!files) return
  for (let n = 0; n < files.length; ++n) {
    if (isAcceptedFile(files[n])) uploadFile(files[n])
  }
}

const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  isDragging = true
}

const handleDragLeave = (e: DragEvent) => {
  const target = e.currentTarget as HTMLElement
  if (!target.contains(e.relatedTarget as Node)) {
    isDragging = false
  }
}

const handleFileSelect = () => {
  const files = fileInput?.files
  if (!files) return
  for (let n = 0; n < files.length; ++n) {
    uploadFile(files[n])
  }
  if (fileInput) fileInput.value = ''
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

const submit = () => {
  const trimmed = content.trim()
  if ((!trimmed && !pendingImages.length && !pendingFiles.length) || disabled) return
  const images = pendingImages.length ? pendingImages.map(p => p.attachment) : undefined
  const files = pendingFiles.length ? [...pendingFiles] : undefined
  onsubmit(trimmed, images, files)
  for (const img of pendingImages) URL.revokeObjectURL(img.previewUrl)
  pendingImages = []
  pendingFiles = []
  content = ''
  if (textarea) {
    textarea.style.height = 'auto'
  }
}

$effect(() => {
  page.url.pathname
  if (textarea && !disabled) {
    tick().then(() => {
      if (textarea && !disabled) {
        textarea.focus()
      }
    })
  }
})

const autoResize = () => {
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
}

const encodeWav = (samples: Float32Array, sampleRate: number): ArrayBuffer => {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = samples.length * (bitsPerSample / 8)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let n = 0; n < str.length; ++n) view.setUint8(offset + n, str.charCodeAt(n))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let n = 0; n < samples.length; ++n) {
    const clamped = Math.max(-1, Math.min(1, samples[n]))
    view.setInt16(44 + n * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  return buffer
}

const BAR_COUNT = 50
let lastWaveformTime = 0
const WAVEFORM_INTERVAL = 20

const updateWaveform = (timestamp: number) => {
  if (!analyser) return

  if (timestamp - lastWaveformTime >= WAVEFORM_INTERVAL) {
    lastWaveformTime = timestamp
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(dataArray)

    let sum = 0
    for (let n = 0; n < dataArray.length; ++n) {
      sum += dataArray[n]
    }
    const amplitude = Math.min(1, (sum / (dataArray.length * 255)) * 3.5)

    const next = waveformBars.slice(-(BAR_COUNT - 1))
    next.push(amplitude)
    waveformBars = next
  }

  animationFrame = requestAnimationFrame(updateWaveform)
}

const stopAnalyser = () => {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = undefined
  }
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = undefined
  }
  if (audioContext) {
    audioContext.close()
    audioContext = undefined
  }
  analyser = undefined
}

const transcribeAudio = async () => {
  dictationState = 'transcribing'

  const blob = new Blob(audioChunks)
  const arrayBuffer = await blob.arrayBuffer()
  const ctx = new AudioContext()
  const decoded = await ctx.decodeAudioData(arrayBuffer)
  const wavBuffer = encodeWav(decoded.getChannelData(0), decoded.sampleRate)
  await ctx.close()
  const bytes = new Uint8Array(wavBuffer)
  let binary = ''
  for (let n = 0; n < bytes.length; ++n) binary += String.fromCharCode(bytes[n])
  const base64 = btoa(binary)

  try {
    const res = await fetch('/api/dictation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64 }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Dictation failed' }))
      console.error('Dictation error:', err.message ?? err)
    } else {
      const { text } = await res.json()
      if (text) {
        content += (content && !content.endsWith(' ') ? ' ' : '') + text
        autoResize()
      }
    }
  } catch (err) {
    console.error('Dictation error:', err)
  } finally {
    dictationState = 'idle'
  }
}

let activeStream: MediaStream | undefined

const startRecording = async () => {
  if (dictationState !== 'idle') return

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    activeStream = stream
    audioChunks = []
    recordingSeconds = 0
    waveformBars = Array(BAR_COUNT).fill(0)

    audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.3
    source.connect(analyser)
    lastWaveformTime = 0
    animationFrame = requestAnimationFrame(updateWaveform)

    timerInterval = setInterval(() => {
      ++recordingSeconds
    }, 1000)

    mediaRecorder = new MediaRecorder(stream)
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }
    mediaRecorder.start()
    dictationState = 'recording'
  } catch (err) {
    console.error('Microphone access denied:', err)
    dictationState = 'idle'
  }
}

const stopAndTranscribe = () => {
  if (!mediaRecorder || dictationState !== 'recording') return
  stopAnalyser()
  mediaRecorder.onstop = () => {
    if (activeStream) {
      for (const track of activeStream.getTracks()) track.stop()
      activeStream = undefined
    }
    transcribeAudio()
  }
  mediaRecorder.stop()
}

const cancelRecording = () => {
  if (!mediaRecorder || dictationState !== 'recording') return
  stopAnalyser()
  mediaRecorder.onstop = () => {
    if (activeStream) {
      for (const track of activeStream.getTracks()) track.stop()
      activeStream = undefined
    }
  }
  mediaRecorder.stop()
  audioChunks = []
  dictationState = 'idle'
}
</script>

<div class="px-4 pb-4 pt-2">
  {#if dictationState === 'recording'}
    <div class="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/40">
      <button
        onclick={cancelRecording}
        aria-label="Cancel recording"
        class="shrink-0 rounded-full bg-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div class="flex min-w-0 flex-1 items-center gap-2">
        <div class="flex flex-1 items-center justify-center gap-[2px]" style="height: 32px;">
          {#each waveformBars as bar}
            <div
              class="w-[3px] rounded-full bg-blue-500 transition-all duration-75 dark:bg-blue-400"
              style="height: {Math.max(3, bar * 28 + 3)}px"
            ></div>
          {/each}
        </div>
        <span class="shrink-0 text-xs font-medium tabular-nums text-gray-500 dark:text-neutral-400">
          {formattedTime()}
        </span>
      </div>

      <button
        onclick={stopAndTranscribe}
        aria-label="Finish recording"
        class="shrink-0 rounded-full bg-blue-600 p-2 text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
        </svg>
      </button>
    </div>
  {:else if dictationState === 'transcribing'}
    <div class="mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 dark:border-neutral-600 dark:bg-neutral-700">
      <svg class="h-4 w-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span class="text-sm text-gray-500 dark:text-neutral-400">Transcribing…</span>
    </div>
  {:else}
    <div
      class="mx-auto max-w-3xl rounded-2xl border bg-gray-50 transition-colors dark:bg-neutral-700 {isDragging ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30' : 'border-gray-200 dark:border-neutral-600'}"
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      role="presentation"
    >
      {#if pendingImages.length > 0 || pendingFiles.length > 0 || uploadingCount > 0}
        <div class="flex flex-wrap gap-2 px-4 pt-3">
          {#each pendingImages as img, idx (img.attachment.id)}
            <div class="group relative">
              <img src={img.previewUrl} alt="Attached" class="h-16 w-16 rounded-lg border border-gray-200 object-cover dark:border-neutral-600" />
              <button
                onclick={() => removeImage(idx)}
                aria-label="Remove image"
                class="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-neutral-200 dark:text-neutral-900"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          {/each}
          {#each pendingFiles as file, idx (file.id)}
            <div class="group relative flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-neutral-600 dark:bg-neutral-800">
              <svg class="h-4 w-4 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span class="max-w-[120px] truncate text-xs text-gray-700 dark:text-neutral-300">{file.filename}</span>
              <button
                onclick={() => removeFile(idx)}
                aria-label="Remove file"
                class="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-neutral-200 dark:text-neutral-900"
              >
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          {/each}
          {#if uploadingCount > 0}
            <div class="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-neutral-500">
              <svg class="h-5 w-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          {/if}
        </div>
      {/if}

      <div class="flex items-end gap-1.5 px-4 py-2.5">
        <input
          bind:this={fileInput}
          type="file"
          accept="image/*,.csv,text/csv"
          multiple
          onchange={handleFileSelect}
          class="hidden"
        />
        <textarea
          bind:this={textarea}
          bind:value={content}
          onkeydown={handleKeydown}
          oninput={autoResize}
          onpaste={handlePaste}
          placeholder="Send a Message"
          rows="1"
          disabled={disabled}
          class="flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-gray-400 disabled:opacity-50 dark:text-white dark:placeholder:text-neutral-400"
        ></textarea>

        <div class="flex shrink-0 items-center gap-1">
          <button
            onclick={() => fileInput?.click()}
            aria-label="Attach file"
            disabled={disabled}
            class="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-600 dark:hover:text-white"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <button
            onclick={startRecording}
            aria-label="Dictation"
            disabled={disabled}
            class="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-600 dark:hover:text-white"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
            </svg>
          </button>

          {#if isStreaming}
            <button
              onclick={onstop}
              aria-label="Stop generating"
              class="rounded-full bg-gray-900 p-2 text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          {/if}
          {#if !isStreaming || content.trim() || pendingImages.length || pendingFiles.length}
            <button
              onclick={submit}
              disabled={(!content.trim() && !pendingImages.length && !pendingFiles.length) || disabled}
              aria-label="Send message"
              class="rounded-full bg-gray-900 p-2 text-white transition-colors hover:bg-gray-700 disabled:opacity-30 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
