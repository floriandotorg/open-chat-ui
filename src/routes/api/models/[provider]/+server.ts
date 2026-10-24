import { storedModelInfo } from '#lib/provider-models.ts'
import { getDecryptedKey } from '#lib/server/api-key.ts'
import { requireUser } from '#lib/server/auth-guard.ts'
import { mapProviderModel } from '#lib/server/db/records.ts'
import { ensureProviderSynced } from '#lib/server/model-sync.ts'
import { pb } from '#lib/server/pb.ts'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const apiKey = await getDecryptedKey(userId, params.provider)
  if (!apiKey) {
    throw error(400, `No API key configured for ${params.provider}`)
  }

  const listRows = () =>
    pb
      .collection('provider_models')
      .getFullList({ filter: pb.filter('provider = {:p}', { p: params.provider }) })
      .then(rows => rows.map(mapProviderModel))

  let stored = await listRows()

  if (stored.length === 0) {
    await ensureProviderSynced(params.provider)
    stored = await listRows()
  }

  return json(stored.filter(s => s.enabled).map(storedModelInfo))
}
