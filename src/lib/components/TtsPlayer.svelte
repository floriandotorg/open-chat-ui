<script lang="ts">
import type { createTtsPlayer } from '$lib/stores/tts-player.svelte'
import { getContext } from 'svelte'

const tts: ReturnType<typeof createTtsPlayer> = getContext('tts-player')

const formatTime = (s: number) => {
  if (!s || !Number.isFinite(s)) return '00:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

const speedLabel = $derived(tts.speed === 1 ? '1x' : `${tts.speed}x`)
</script>

{#if tts.visible}
  <div class="tts-bar fixed top-3 z-[100]">
    <div class="tts-glass animate-slide-down flex items-center gap-1 rounded-2xl px-2 py-1.5">
      {#if tts.loading}
        <div class="flex h-10 w-10 items-center justify-center">
          <svg class="h-5 w-5 animate-spin text-white/70" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
        <span class="min-w-[3rem] pl-1 text-sm font-medium tabular-nums text-white/50">--:--</span>
      {:else}
        <button
          onclick={() => tts.togglePlay()}
          class="flex h-10 w-10 shrink-0 items-center justify-center text-white/90 transition-colors hover:text-white"
          aria-label={tts.playing ? 'Pause' : 'Play'}
        >
          {#if tts.playing}
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="5" height="18" rx="1.5" /><rect x="14" y="3" width="5" height="18" rx="1.5" /></svg>
          {:else}
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8z" /></svg>
          {/if}
        </button>

        <span class="min-w-[3rem] pl-1 text-sm font-medium tabular-nums text-white">{formatTime(tts.currentTime)}</span>
      {/if}

      {#if tts.errorMessage}
        <span class="mx-2 max-w-[12rem] truncate text-xs text-red-400">{tts.errorMessage}</span>
      {/if}

      <div class="flex-1"></div>

      <button
        onclick={() => tts.cycleSpeed()}
        class="flex h-9 min-w-[2.5rem] items-center justify-center px-2 text-sm font-semibold tabular-nums text-white/70 transition-colors hover:text-white"
        aria-label="Change playback speed"
      >
        {speedLabel}
      </button>

      <button
        onclick={() => tts.seekRelative(-15)}
        class="skip-btn flex h-9 w-9 items-center justify-center text-white/70 transition-colors hover:text-white"
        aria-label="Back 15 seconds"
      >
        <svg class="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 4v6h6" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
        <span class="skip-label">15</span>
      </button>

      <button
        onclick={() => tts.seekRelative(15)}
        class="skip-btn flex h-9 w-9 items-center justify-center text-white/70 transition-colors hover:text-white"
        aria-label="Forward 15 seconds"
      >
        <svg class="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        <span class="skip-label">15</span>
      </button>

      <button
        onclick={() => tts.close()}
        class="flex h-9 w-9 items-center justify-center text-white/50 transition-colors hover:text-white"
        aria-label="Close player"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  </div>
{/if}

<style>
  @keyframes slide-down {
    from { opacity: 0; transform: translateY(-1rem); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-slide-down {
    animation: slide-down 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tts-bar {
    left: 50%;
    transform: translateX(-50%);
    width: min(calc(100vw - 1.5rem), 28rem);
  }
  .tts-glass {
    background: rgba(30, 30, 32, 0.45);
    -webkit-backdrop-filter: blur(50px) saturate(1.8) brightness(1.1);
    backdrop-filter: blur(50px) saturate(1.8) brightness(1.1);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow:
      0 0 0 0.5px rgba(255, 255, 255, 0.08),
      0 8px 40px rgba(0, 0, 0, 0.35),
      0 2px 12px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      inset 0 -1px 0 rgba(0, 0, 0, 0.1);
  }
  .skip-btn {
    position: relative;
  }
  .skip-label {
    position: absolute;
    font-size: 7.5px;
    font-weight: 700;
    line-height: 1;
    margin-top: 2px;
    pointer-events: none;
  }
</style>
