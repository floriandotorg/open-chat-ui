<script lang="ts">
import type { ModelUsage, UsageResponse } from '#lib/types.ts'
import { onMount } from 'svelte'

const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'

let data = $state<UsageResponse | null>(null)
let loading = $state(true)
let errorMsg = $state('')

const fmtMoney = (n: number): string => {
  if (n === 0) {
    return '$0.00'
  }
  if (n < 0.01) {
    return '<$0.01'
  }
  return `$${n.toFixed(2)}`
}

const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`
  }
  return String(n)
}

const fmtDate = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const monthName = (ym: string): string => {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

const paid = $derived(data ? data.api.cost + data.plan.cost : 0)
const withoutPlan = $derived(data ? paid + data.plan.apiEquivalentCost : 0)
const hasPlanUsage = $derived(!!data && data.plan.requests > 0)
const hasData = $derived(!!data && data.api.requests + data.plan.requests > 0)
const planModels = $derived(data?.models.filter(m => m.billing === 'plan') ?? [])
const apiModels = $derived(data?.models.filter(m => m.billing === 'api') ?? [])
const hasUnpricedPlanModels = $derived(planModels.some(m => !m.priced))
const maxDaily = $derived(data ? Math.max(0.0001, ...data.daily.map(d => d.apiCost + d.planApiEquivalentCost)) : 0)

onMount(async () => {
  try {
    const r = await fetch('/api/usage')
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`)
    }
    data = (await r.json()) as UsageResponse
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : 'Failed to load usage'
  } finally {
    loading = false
  }
})
</script>

{#snippet modelRow(m: ModelUsage)}
  <div class="px-4 py-3">
    <div class="flex items-center justify-between gap-2">
      <span class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{m.model}</span>
      {#if m.billing === 'plan'}
        <span class="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400" title="What these tokens would have cost on the OpenAI API">{m.priced ? fmtMoney(m.apiEquivalentCost) : 'n/a'}</span>
      {:else}
        <span class="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(m.cost)}</span>
      {/if}
    </div>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
      <span>{m.requests} req</span>
      <span>↓ {fmtTokens(m.inputTokens)}</span>
      <span>↑ {fmtTokens(m.outputTokens)}</span>
      {#if m.cacheReadInputTokens > 0}
        <span class="text-emerald-600 dark:text-emerald-400">cache {fmtTokens(m.cacheReadInputTokens)}</span>
      {/if}
      {#if m.billing === 'plan' && m.priced}
        <span>API equivalent</span>
      {/if}
      {#if m.billing === 'plan' && m.cost > 0}
        <span>paid tools {fmtMoney(m.cost)}</span>
      {/if}
      {#if !m.priced}
        <span class="text-amber-500" title="No API pricing data available for this model">unpriced</span>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet modelSection(title: string, models: ModelUsage[], manageUsage: boolean)}
  <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
      <p class="text-xs uppercase tracking-wide text-gray-400">{title}</p>
      {#if manageUsage}
        <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" class="text-xs text-blue-600 hover:underline dark:text-blue-400">Manage usage</a>
      {/if}
    </div>
    <div class="divide-y divide-gray-100 dark:divide-gray-800">
      {#each models as m (m.model)}
        {@render modelRow(m)}
      {/each}
    </div>
  </div>
{/snippet}

{#if loading}
  <div class="py-12 text-center text-sm text-gray-400">Loading usage…</div>
{:else if errorMsg}
  <div class="rounded-lg border border-red-300 p-4 text-sm text-red-600 dark:border-red-800 dark:text-red-400">{errorMsg}</div>
{:else if !data}
  <div class="py-12 text-center text-sm text-gray-400">No usage data.</div>
{:else}
  <div class="space-y-5">
    <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <p class="text-xs uppercase tracking-wide text-gray-400">{monthName(data.month)}</p>
      <div class="mt-2 grid gap-4 {hasPlanUsage ? 'grid-cols-2' : 'grid-cols-1'}">
        <div>
          <p class="text-xs text-gray-500 dark:text-gray-400">Paid</p>
          <p class="mt-0.5 text-3xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(paid)}</p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{data.api.requests} req · ↓ {fmtTokens(data.api.inputTokens)} · ↑ {fmtTokens(data.api.outputTokens)}</p>
          {#if data.plan.cost > 0}
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Includes {fmtMoney(data.plan.cost)} of paid tools in ChatGPT plan chats</p>
          {/if}
        </div>
        {#if hasPlanUsage}
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">ChatGPT plan, API equivalent</p>
            <p class="mt-0.5 text-3xl font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(data.plan.apiEquivalentCost)}</p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{data.plan.requests} req · ↓ {fmtTokens(data.plan.inputTokens)} · ↑ {fmtTokens(data.plan.outputTokens)}</p>
          </div>
        {/if}
      </div>
      {#if hasPlanUsage}
        <p class="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
          Without your ChatGPT plan, this month would have cost <span class="font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(withoutPlan)}</span>.
          {#if hasUnpricedPlanModels}
            <span class="text-amber-500">Some plan models have no public API price and are not included.</span>
          {/if}
        </p>
      {/if}
    </div>

    {#if hasData}
      <div class="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <div class="mb-3 flex items-center justify-between">
          <p class="text-xs uppercase tracking-wide text-gray-400">Daily cost</p>
          {#if hasPlanUsage}
            <div class="flex gap-3 text-[10px] text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-blue-500/70 dark:bg-blue-400/60"></span>Paid</span>
              <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-emerald-500/70 dark:bg-emerald-400/60"></span>ChatGPT plan (API equivalent)</span>
            </div>
          {/if}
        </div>
        <div class="flex h-32 items-end gap-px">
          {#each data.daily as day (day.date)}
            {@const total = day.apiCost + day.planApiEquivalentCost}
            {@const height = total > 0 ? Math.max(2, (total / maxDaily) * 100) : 2}
            <div class="group relative flex h-full flex-1 flex-col justify-end" title={`${fmtDate(day.date)}: ${fmtMoney(day.apiCost)} paid, ${fmtMoney(day.planApiEquivalentCost)} plan (${day.requests} req)`}>
              <div class="flex flex-col overflow-hidden rounded-t-sm" style="height: {height}%">
                {#if total > 0}
                  <div class="bg-emerald-500/70 transition-colors group-hover:bg-emerald-500 dark:bg-emerald-400/60 dark:group-hover:bg-emerald-400" style="height: {(day.planApiEquivalentCost / total) * 100}%"></div>
                  <div class="flex-1 bg-blue-500/70 transition-colors group-hover:bg-blue-500 dark:bg-blue-400/60 dark:group-hover:bg-blue-400"></div>
                {:else}
                  <div class="flex-1 bg-blue-500/70 dark:bg-blue-400/60"></div>
                {/if}
              </div>
              {#if total > 0}
                <div class="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block dark:bg-gray-700">
                  {fmtDate(day.date)} · {fmtMoney(day.apiCost)} paid{day.planApiEquivalentCost > 0 ? ` · ${fmtMoney(day.planApiEquivalentCost)} plan` : ''}
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

      {#if planModels.length}
        {@render modelSection('ChatGPT plan, per model', planModels, true)}
      {/if}
      {#if apiModels.length}
        {@render modelSection('API, per model', apiModels, false)}
      {/if}
    {:else}
      <div class="rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400 dark:border-gray-800">No messages this month yet.</div>
    {/if}
  </div>
{/if}
