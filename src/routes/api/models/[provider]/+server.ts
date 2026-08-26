import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { mapProviderModel } from '$lib/server/db/records'
import { pb } from '$lib/server/pb'
import { storedModelInfo } from '$lib/server/provider-models'
import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const apiKey = await getDecryptedKey(userId, params.provider)
  if (!apiKey) {
    throw error(400, `No API key configured for ${params.provider}`)
  }

  const provider = getProviderFactory(params.provider)(apiKey)

  const stored = (await pb.collection('provider_models').getFullList({ filter: pb.filter('provider = {:p}', { p: params.provider }) })).map(mapProviderModel)

  if (provider.supportsCustomModels) {
    return json(stored.filter(s => s.enabled).map(storedModelInfo))
  }

  const allModels = await provider.listModels()

  if (stored.length === 0) {
    return json(allModels)
  }

  const disabledSet = new Set(stored.filter(s => !s.enabled).map(s => s.modelId))

  return json(allModels.filter(m => !disabledSet.has(parseModelRef(m.id).model)))
}
