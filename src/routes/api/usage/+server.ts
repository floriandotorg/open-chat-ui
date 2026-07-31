import { requireUser } from '$lib/server/auth-guard'
import { pb } from '$lib/server/pb'
import { getPricing } from '$lib/server/pricing'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

interface UsageRow {
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  createdAt: string
}

interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

interface DailyUsage {
  date: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  requests: number
}

interface ModelUsage {
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  cost: number
  priced: boolean
}

interface UsageResponse {
  month: string
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadInputTokens: number
  totalCacheCreationInputTokens: number
  totalRequests: number
  cacheSavings: number
  daily: DailyUsage[]
  models: ModelUsage[]
}

const num = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0)

const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const now = new Date()
  const month = monthKey(now)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const today = dayKey(now)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()

  const rows = await pb.collection('messages').getFullList({
    filter: pb.filter('conversation.user = {:u} && createdAt >= {:s} && model != ""', { u: userId, s: monthStart }),
    fields: 'model,inputTokens,outputTokens,cacheReadInputTokens,cacheCreationInputTokens,createdAt',
  })

  const pricingCache = new Map<string, ModelPricing | null>()
  const getPricingCached = async (model: string): Promise<ModelPricing | null> => {
    let p = pricingCache.get(model)
    if (p === undefined) {
      p = await getPricing(model)
      pricingCache.set(model, p)
    }
    return p
  }

  const dailyMap = new Map<string, DailyUsage>()
  for (let d = 1; d <= daysInMonth; ++d) {
    const key = dayKey(new Date(now.getFullYear(), now.getMonth(), d))
    dailyMap.set(key, {
      date: key,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 0,
    })
  }

  const modelMap = new Map<string, ModelUsage>()
  let totalCost = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheReadInputTokens = 0
  let totalCacheCreationInputTokens = 0
  let totalRequests = 0
  let cacheSavings = 0

  for (const row of rows as unknown as UsageRow[]) {
    const model = row.model ?? ''
    const inputTokens = num(row.inputTokens)
    const outputTokens = num(row.outputTokens)
    const cacheRead = num(row.cacheReadInputTokens)
    const cacheCreation = num(row.cacheCreationInputTokens)
    const createdAt = new Date(row.createdAt)
    const day = dayKey(createdAt)

    const pricing = await getPricingCached(model)
    const priced = pricing !== null
    let cost = 0
    let savings = 0
    if (pricing) {
      cost = inputTokens * pricing.input + outputTokens * pricing.output + cacheRead * pricing.cacheRead + cacheCreation * pricing.cacheCreation
      savings = cacheRead * (pricing.input - pricing.cacheRead)
    }

    totalCost += cost
    totalInputTokens += inputTokens
    totalOutputTokens += outputTokens
    totalCacheReadInputTokens += cacheRead
    totalCacheCreationInputTokens += cacheCreation
    totalRequests += 1
    cacheSavings += savings

    const dayEntry = dailyMap.get(day)
    if (dayEntry) {
      dayEntry.cost += cost
      dayEntry.inputTokens += inputTokens
      dayEntry.outputTokens += outputTokens
      dayEntry.cacheReadInputTokens += cacheRead
      dayEntry.cacheCreationInputTokens += cacheCreation
      dayEntry.requests += 1
    }

    let modelEntry = modelMap.get(model)
    if (!modelEntry) {
      modelEntry = {
        model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        cost: 0,
        priced,
      }
      modelMap.set(model, modelEntry)
    }
    modelEntry.requests += 1
    modelEntry.inputTokens += inputTokens
    modelEntry.outputTokens += outputTokens
    modelEntry.cacheReadInputTokens += cacheRead
    modelEntry.cacheCreationInputTokens += cacheCreation
    modelEntry.cost += cost
  }

  const daily = [...dailyMap.values()].filter(d => d.date <= today)
  const models = [...modelMap.values()].sort((a, b) => b.cost - a.cost)

  const response: UsageResponse = {
    month,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadInputTokens,
    totalCacheCreationInputTokens,
    totalRequests,
    cacheSavings,
    daily,
    models,
  }
  return json(response)
}
