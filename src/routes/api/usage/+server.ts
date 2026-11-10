import { requireUser } from '#lib/server/auth-guard.ts'
import { pb } from '#lib/server/pb.ts'
import { getApiEquivalentPricing, type ModelPricing } from '#lib/server/pricing.ts'
import { summarizeUsage, type UsageRow } from '#lib/server/usage-summary.ts'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const rows: UsageRow[] = (
    await pb.collection('messages').getFullList({
      filter: pb.filter('conversation.user = {:u} && createdAt >= {:s} && model != ""', { u: userId, s: monthStart }),
      fields: 'model,inputTokens,outputTokens,cacheReadInputTokens,cacheCreationInputTokens,cost,createdAt',
    })
  ).map(r => ({
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadInputTokens: r.cacheReadInputTokens,
    cacheCreationInputTokens: r.cacheCreationInputTokens,
    cost: r.cost,
    createdAt: r.createdAt,
  }))

  const models = [...new Set(rows.map(r => r.model ?? ''))]
  const pricing = new Map<string, ModelPricing | null>(await Promise.all(models.map(async model => [model, await getApiEquivalentPricing(model).catch(() => null)] as const)))

  return json(summarizeUsage(rows, model => pricing.get(model) ?? null, now))
}
