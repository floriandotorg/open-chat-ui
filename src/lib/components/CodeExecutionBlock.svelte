<script lang="ts">
import type { CodeExecutionBlock } from '$lib/types'

let { codeExecution }: { codeExecution: CodeExecutionBlock } = $props()

let open = $state(false)

let hasResult = $derived(codeExecution.stdout !== undefined || codeExecution.stderr !== undefined || codeExecution.error !== undefined)
let isRunning = $derived(!hasResult)

const extractCode = (input: Record<string, unknown>): string => {
  if (typeof input.command === 'string') return input.command
  if (typeof input.code === 'string') return input.code
  if (typeof input._raw === 'string') {
    try {
      const parsed = JSON.parse(input._raw)
      return parsed.command ?? parsed.code ?? input._raw
    } catch {
      return input._raw
    }
  }
  return ''
}

let command = $derived(extractCode(codeExecution.input ?? {}))
let label = $derived(isRunning ? 'Running code\u2026' : codeExecution.returnCode === 0 ? 'Code executed' : 'Code execution failed')

const isImageMime = (mime: string) => mime.startsWith('image/')

let imageFiles = $derived(codeExecution.files?.filter(f => isImageMime(f.mimeType)) ?? [])
let downloadFiles = $derived(codeExecution.files?.filter(f => !isImageMime(f.mimeType)) ?? [])
</script>

<div class="my-1.5">
  <button
    onclick={() => open = !open}
    class="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 transition-colors"
  >
    {#if isRunning}
      <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a10 10 0 1 0 10 10" stroke-linecap="round" />
      </svg>
    {:else if codeExecution.returnCode === 0}
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    {:else}
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    {/if}
    <span>{label}</span>
    <svg
      class="h-3 w-3 transition-transform {open ? 'rotate-180' : ''}"
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if imageFiles.length}
    <div class="mt-2 flex flex-wrap gap-2">
      {#each imageFiles as file}
        <a href="/api/files/{file.fileId}" download={file.filename} class="group relative block">
          <img
            src="/api/files/{file.fileId}?inline=1"
            alt={file.filename}
            class="max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
          />
          <div class="absolute inset-0 flex items-end justify-center rounded-lg bg-black/0 group-hover:bg-black/30 transition-colors">
            <span class="mb-2 flex items-center gap-1 rounded bg-white/90 dark:bg-gray-800/90 px-2 py-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shadow">
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
              </svg>
              {file.filename}
            </span>
          </div>
        </a>
      {/each}
    </div>
  {/if}

  {#if downloadFiles.length}
    <div class="mt-2 flex flex-wrap gap-2">
      {#each downloadFiles as file}
        <a
          href="/api/files/{file.fileId}"
          download={file.filename}
          class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
          </svg>
          {file.filename}
        </a>
      {/each}
    </div>
  {/if}

  {#if open}
    <div class="mt-1 overflow-hidden rounded-lg border border-violet-200 dark:border-violet-800/50 text-xs">
      {#if command}
        <div class="bg-gray-900 px-3 py-2 font-mono text-[11px] text-gray-200 overflow-x-auto whitespace-pre-wrap break-all">
          <span class="select-none text-gray-500">$ </span>{command}
        </div>
      {/if}
      {#if codeExecution.error}
        <div class="bg-red-50 dark:bg-red-900/20 px-3 py-2 text-red-700 dark:text-red-400 font-mono text-[11px]">
          Error: {codeExecution.error}
        </div>
      {/if}
      {#if codeExecution.stdout}
        <div class="bg-gray-50 dark:bg-gray-900/50 px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
          {codeExecution.stdout}
        </div>
      {/if}
      {#if codeExecution.stderr}
        <div class="bg-amber-50 dark:bg-amber-900/20 px-3 py-2 font-mono text-[11px] text-amber-800 dark:text-amber-300 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {codeExecution.stderr}
        </div>
      {/if}
      {#if isRunning && !command}
        <div class="bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-gray-500 dark:text-gray-400 italic">
          Waiting for execution...
        </div>
      {/if}
    </div>
  {/if}
</div>
