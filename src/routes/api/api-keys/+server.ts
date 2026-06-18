import { requireUser } from '$lib/server/auth-guard'
import { encrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const userKeys = await db.select({ provider: apiKeys.provider }).from(apiKeys).where(eq(apiKeys.userId, userId))
  const keyCounts = new Map<string, number>()
  for (const key of userKeys) {
    keyCounts.set(key.provider, (keyCounts.get(key.provider) ?? 0) + 1)
  }

  const providers = listProviders().map(p => ({
    ...p,
    hasKey: (keyCounts.get(p.id) ?? 0) > 0,
    keyCount: keyCounts.get(p.id) ?? 0,
  }))

  return json(providers)
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const payload = await request.json()
  const provider = typeof payload?.provider === 'string' ? payload.provider.trim() : ''
  const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : ''

  if (!provider || !apiKey) {
    throw error(400, 'Provider and API key are required')
  }

  const [existing] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
    .orderBy(asc(apiKeys.createdAt))
    .limit(1)
  const { encrypted, iv } = await encrypt(apiKey)

  if (existing) {
    await db.update(apiKeys).set({ encryptedKey: encrypted, iv, updatedAt: new Date() }).where(eq(apiKeys.id, existing.id))
  } else {
    await db.insert(apiKeys).values({ userId, provider, encryptedKey: encrypted, iv })
  }

  return json({ success: true, keyCount: 1 })
}
