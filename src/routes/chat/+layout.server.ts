import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { apiKeys, conversations } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { LayoutServerLoad } from './$types'
import { desc, eq } from 'drizzle-orm'

export const load: LayoutServerLoad = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const [convos, userKeys] = await Promise.all([db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)), db.select({ provider: apiKeys.provider }).from(apiKeys).where(eq(apiKeys.userId, userId))])

  const configuredProviders = new Set(userKeys.map(k => k.provider))
  const providers = listProviders().map(p => ({
    ...p,
    hasKey: configuredProviders.has(p.id),
  }))

  return { conversations: convos, providers }
}
