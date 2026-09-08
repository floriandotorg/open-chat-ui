import { requireUser } from '$lib/server/auth-guard'
import { encrypt } from '$lib/server/crypto'
import { mapApiKey, now } from '$lib/server/db/records'
import { ensureProviderSynced } from '$lib/server/model-sync'
import { createOrRecover, getFirstOrNull, pb } from '$lib/server/pb'
import { listProviders } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const userKeys = await pb.collection('api_keys').getFullList({ filter: pb.filter('user = {:u}', { u: userId }), fields: 'provider' })
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

  const existing = await getFirstOrNull(
    pb
      .collection('api_keys')
      .getFirstListItem(pb.filter('user = {:u} && provider = {:p}', { u: userId, p: provider }), { sort: 'createdAt' })
      .then(mapApiKey),
  )
  const { encrypted, iv } = await encrypt(apiKey)

  if (existing) {
    await pb.collection('api_keys').update(existing.id, { encryptedKey: encrypted, iv, updatedAt: now() })
  } else {
    await createOrRecover('api_keys', { user: userId, provider, encryptedKey: encrypted, iv, createdAt: now(), updatedAt: now() }, pb.filter('user = {:u} && provider = {:p}', { u: userId, p: provider }), { encryptedKey: encrypted, iv, updatedAt: now() })
  }

  void ensureProviderSynced(provider)

  return json({ success: true, keyCount: 1 })
}
