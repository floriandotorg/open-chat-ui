import { keyFingerprint, normalizeKeyList, parseDecryptedKeyValue, serializeKeyValues } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { decrypt, encrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

const maskSecret = (value: string) => (value.length <= 4 ? '••••' : `•••• ${value.slice(-4)}`)

const readStringField = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object') return ''
  const field = Reflect.get(value, key)
  return typeof field === 'string' ? field.trim() : ''
}

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const userKeys = await db.select({ provider: apiKeys.provider, encryptedKey: apiKeys.encryptedKey, iv: apiKeys.iv }).from(apiKeys).where(eq(apiKeys.userId, userId))
  const keyCounts = new Map<string, number>()
  for (const key of userKeys) {
    const count = key.provider === 'scraperapi' ? parseDecryptedKeyValue(key.provider, await decrypt(key.encryptedKey, key.iv)).length : 1
    keyCounts.set(key.provider, (keyCounts.get(key.provider) ?? 0) + count)
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
  const provider = readStringField(payload, 'provider')
  const apiKey = readStringField(payload, 'apiKey')

  if (!provider || !apiKey) {
    throw error(400, 'Provider and API key are required')
  }

  if (provider === 'scraperapi') {
    const existingRows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
      .orderBy(asc(apiKeys.createdAt))
    const decrypted = await Promise.all(existingRows.map(row => decrypt(row.encryptedKey, row.iv)))
    const existingKeys = normalizeKeyList(decrypted.flatMap(value => parseDecryptedKeyValue(provider, value)))

    if (existingKeys.includes(apiKey)) {
      return json({ success: true, duplicate: true, key: { id: keyFingerprint(apiKey), label: maskSecret(apiKey) }, keyCount: existingKeys.length })
    }

    const nextKeys = normalizeKeyList([...existingKeys, apiKey])
    const { encrypted, iv } = await encrypt(serializeKeyValues(nextKeys))
    const [existing] = existingRows

    if (existing) {
      await db.update(apiKeys).set({ encryptedKey: encrypted, iv, updatedAt: new Date() }).where(eq(apiKeys.id, existing.id))
    } else {
      await db.insert(apiKeys).values({ userId, provider, encryptedKey: encrypted, iv })
    }

    return json({ success: true, key: { id: keyFingerprint(apiKey), label: maskSecret(apiKey) }, keyCount: nextKeys.length })
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
