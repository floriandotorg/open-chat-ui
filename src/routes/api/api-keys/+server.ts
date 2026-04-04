import { requireUser } from '$lib/server/auth-guard'
import { encrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const userKeys = await db.select({ provider: apiKeys.provider }).from(apiKeys).where(eq(apiKeys.userId, userId))

  const configuredProviders = new Set(userKeys.map(k => k.provider))

  const providers = listProviders().map(p => ({
    ...p,
    hasKey: configuredProviders.has(p.id),
  }))

  return json(providers)
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { provider, apiKey } = (await request.json()) as { provider: string; apiKey: string }

  const { encrypted, iv } = await encrypt(apiKey)

  await db
    .insert(apiKeys)
    .values({
      userId,
      provider,
      encryptedKey: encrypted,
      iv,
    })
    .onConflictDoUpdate({
      target: [apiKeys.userId, apiKeys.provider],
      set: {
        encryptedKey: encrypted,
        iv,
        updatedAt: new Date(),
      },
    })

  return json({ success: true })
}
