import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { apiKeys, conversations, systemPrompts } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { LayoutServerLoad } from './$types'
import { asc, desc, eq } from 'drizzle-orm'

export const load: LayoutServerLoad = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const [convos, userKeys, prompts] = await Promise.all([
    db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)),
    db.select({ provider: apiKeys.provider }).from(apiKeys).where(eq(apiKeys.userId, userId)),
    db.select().from(systemPrompts).where(eq(systemPrompts.userId, userId)).orderBy(asc(systemPrompts.createdAt)),
  ])

  const configuredProviders = new Set(userKeys.map(k => k.provider))
  const providers = listProviders().map(p => ({
    ...p,
    hasKey: configuredProviders.has(p.id),
  }))

  return {
    conversations: convos.map(c => ({
      ...c,
      defaultModel: normalizeModelRef(c.defaultProvider, c.defaultModel),
    })),
    providers,
    systemPrompts: prompts,
  }
}
