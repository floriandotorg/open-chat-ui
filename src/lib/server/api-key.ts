import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import { and, eq } from 'drizzle-orm'

export const getDecryptedKey = async (userId: string, provider: string): Promise<string | null> => {
  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
  if (!keyRow) return null
  return decrypt(keyRow.encryptedKey, keyRow.iv)
}
