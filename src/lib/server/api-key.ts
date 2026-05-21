import { createHash } from 'node:crypto'
import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import { and, asc, desc, eq } from 'drizzle-orm'

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

export const normalizeKeyList = (keys: string[]) => [...new Set(keys.map(key => key.trim()).filter(Boolean))]

export const parseDecryptedKeyValue = (provider: string, value: string): string[] => {
  if (provider !== 'scraperapi') {
    return value.trim() ? [value] : []
  }

  try {
    const parsed: unknown = JSON.parse(value)
    if (isStringArray(parsed)) {
      return normalizeKeyList(parsed)
    }
    if (parsed && typeof parsed === 'object') {
      const keys = Reflect.get(parsed, 'keys')
      if (isStringArray(keys)) {
        return normalizeKeyList(keys)
      }
    }
  } catch {}

  return value.trim() ? [value] : []
}

export const serializeKeyValues = (keys: string[]) => JSON.stringify({ keys: normalizeKeyList(keys) })

export const keyFingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16)

export const getDecryptedKey = async (userId: string, provider: string): Promise<string | null> => {
  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
    .orderBy(desc(apiKeys.updatedAt))
    .limit(1)
  if (!keyRow) return null
  const [key] = parseDecryptedKeyValue(provider, await decrypt(keyRow.encryptedKey, keyRow.iv))
  return key ?? null
}

export const getDecryptedKeys = async (userId: string, provider: string): Promise<string[]> => {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
    .orderBy(asc(apiKeys.createdAt))
  const decrypted = await Promise.all(rows.map(row => decrypt(row.encryptedKey, row.iv)))
  return normalizeKeyList(decrypted.flatMap(value => parseDecryptedKeyValue(provider, value)))
}
