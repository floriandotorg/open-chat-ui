import { createHash } from 'node:crypto'
import { decrypt } from '$lib/server/crypto'
import { mapApiKey } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'

export const normalizeKeyList = (keys: string[]) => [...new Set(keys.map(key => key.trim()).filter(Boolean))]

export const keyFingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16)

export const getDecryptedKey = async (userId: string, provider: string): Promise<string | null> => {
  const row = await getFirstOrNull(
    pb
      .collection('api_keys')
      .getFirstListItem(pb.filter('user = {:u} && provider = {:p}', { u: userId, p: provider }), { sort: '-updatedAt' })
      .then(mapApiKey),
  )
  if (!row) return null
  return (await decrypt(row.encryptedKey, row.iv)).trim() || null
}

export const getDecryptedKeys = async (userId: string, provider: string): Promise<string[]> => {
  const rows = await pb.collection('api_keys').getFullList({ filter: pb.filter('user = {:u} && provider = {:p}', { u: userId, p: provider }), sort: 'createdAt' })
  const decrypted = await Promise.all(rows.map(row => decrypt(row.encryptedKey, row.iv)))
  return normalizeKeyList(decrypted.map(key => key.trim()))
}
