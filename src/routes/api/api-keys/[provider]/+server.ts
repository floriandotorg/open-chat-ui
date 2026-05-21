import { keyFingerprint, parseDecryptedKeyValue, serializeKeyValues } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { decrypt, encrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
  const userId = requireUser(locals.user).id
  const keyId = url.searchParams.get('keyId')

  if (params.provider === 'scraperapi' && keyId) {
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, params.provider)))
      .orderBy(asc(apiKeys.createdAt))
    let removed = false

    for (const row of rows) {
      const keys = parseDecryptedKeyValue(params.provider, await decrypt(row.encryptedKey, row.iv))
      const nextKeys = row.id === keyId ? [] : keys.filter(key => keyFingerprint(key) !== keyId)
      if (nextKeys.length === keys.length) continue

      removed = true
      if (nextKeys.length === 0) {
        await db.delete(apiKeys).where(eq(apiKeys.id, row.id))
      } else {
        const { encrypted, iv } = await encrypt(serializeKeyValues(nextKeys))
        await db.update(apiKeys).set({ encryptedKey: encrypted, iv, updatedAt: new Date() }).where(eq(apiKeys.id, row.id))
      }
    }

    if (!removed) {
      throw error(404, 'API key not found')
    }

    return new Response(null, { status: 204 })
  }

  const where = keyId ? and(eq(apiKeys.userId, userId), eq(apiKeys.provider, params.provider), eq(apiKeys.id, keyId)) : and(eq(apiKeys.userId, userId), eq(apiKeys.provider, params.provider))
  const deleted = await db.delete(apiKeys).where(where).returning({ id: apiKeys.id })

  if (deleted.length === 0) {
    throw error(404, 'API key not found')
  }

  return new Response(null, { status: 204 })
}
