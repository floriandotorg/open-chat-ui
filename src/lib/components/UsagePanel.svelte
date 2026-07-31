<script lang="ts">
import type { UsageResponse } from '$lib/types'
import { onMount } from 'svelte'

let data = $state<UsageResponse | null>(null)
let loading = $state(true)
let errorMsg = $state('')

const fmtMoney = (n: number): string => {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}

const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const fmtDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const monthName = (ym: string): string => {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

const maxDaily = $derived(data ? Math.max(0.0001, ...data.daily.map(d => d.cost)) : 0)
const hasData = $derived(!!data && data.totalRequests > 0)

onMount(async () => {
  try {
    const r = await fetch('/api/usage')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    data = (await r.json()) as UsageResponse
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : 'Failed to load usage'
  } finally {
    loading = false
  }
})
</script>

{#if loading}
  <div class="py-12 text-center text-sm text-gray-400">Loading usage…</div>
{:else if errorMsg}
  <div class="rounded-lg border border-red-300 p-4 text-sm text-red-600 dark:border-red-800 dark:text-red-400">{errorMsg}</div>
{:else if !data}
  <div class="py-12 text-center text-sm text-gray-400">No usage data.</div>
{:else}
  <div class="space-y-5">
    <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <p class="text-xs uppercase tracking-wide text-gray-400">Total cost — {monthName(data.month)}</p>
      <p class="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(data.totalCost)}</p>
      <div class="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p class="text-gray-400">Input tokens</p>
          <p class="font-medium text-gray-700 dark:text-gray-300">{fmtTokens(data.totalInputTokens)}</p>
        </div>
        <div>
          <p class="text-gray-400">Output tokens</p>
          <p class="font-medium text-gray-700 dark:text-gray-300">{fmtTokens(data.totalOutputTokens)}</p>
        </div>
        <div>
          <p class="text-gray-400">Requests</p>
          <p class="font-medium text-gray-700 dark:text-gray-300">{data.totalRequests}</p>
        </div>
      </div>
    </div>

    {#if data.cacheSavings > 0 || data.totalCacheReadInputTokens > 0}
      <div class="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-900/10">
        <p class="text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Prompt caching</p>
        <div class="mt-1 flex items-baseline gap-2">
          <p class="text-xl font-semibold text-emerald-700 dark:text-emerald-300">{fmtTokens(data.totalCacheReadInputTokens)} read</p>
          <span class="text-xs text-emerald-600/80 dark:text-emerald-400/80">+ {fmtTokens(data.totalCacheCreationInputTokens)} written</span>
        </div>
        {#if data.cacheSavings > 0}
          <p class="mt-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">Estimated savings {fmtMoney(data.cacheSavings)} vs. uncached input</p>
        {/if}
      </div>
    {/if}

    {#if hasData}
      <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <p class="mb-3 text-xs uppercase tracking-wide text-gray-400">Daily cost — {monthName(data.month)}</p>
        <div class="flex h-32 items-end gap-px">
          {#each data.daily as day (day.date)}
            {@const h = maxDaily > 0 ? Math.max(2, (day.cost / maxDaily) * 100) : 0}
            <div
              class="group relative flex-1 rounded-t-sm bg-blue-500/70 transition-colors hover:bg-blue-500 dark:bg-blue-400/60 dark:hover:bg-blue-400"
              style="height: {h}%"
              title={`${fmtDate(day.date)}: ${fmtMoney(day.cost)} (${day.requests} req)`}
            >
              {#if day.cost > 0}
                <div class="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block dark:bg-gray-700">
                  {fmtDate(day.date)} · {fmtMoney(day.cost)}
                </div>
              {/if}
            </div>
          {/each}
        </div>
        <div class="mt-1.5 flex justify-between text-[10px] text-gray-400">
          <span>{fmtDate(data.daily[0]?.date ?? '')}</span>
          <span>{fmtDate(data.daily[data.daily.length - 1]?.date ?? '')}</span>
        </div>
      </div>
    {/if}

    {#if hasData}
      <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
        <div class="border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
          <p class="text-xs uppercase tracking-wide text-gray-400">Per model</p>
        </div>
        <div class="divide-y divide-gray-100 dark:divide-gray-800">
          {#each data.models as m (m.model)}
            <div class="px-4 py-3">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{m.model}</span>
                <span class="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(m.cost)}</span>
              </div>
              <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                <span>{m.requests} req</span>
                <span>↓ {fmtTokens(m.inputTokens)}</span>
                <span>↑ {fmtTokens(m.outputTokens)}</span>
                {#if m.cacheReadInputTokens > 0}
                  <span class="text-emerald-600 dark:text-emerald-400">cache {fmtTokens(m.cacheReadInputTokens)}</span>
                {/if}
                {#if !m.priced}
                  <span class="text-amber-500" title="No pricing data available for this model">unpriced</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400 dark:border-gray-800">
        No messages this month yet.
      </div>
    {/if}
  </div>
{/if}
