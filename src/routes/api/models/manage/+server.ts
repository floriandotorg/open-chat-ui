import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { mapProviderModel, now } from '$lib/server/db/records'
import { createOrRecover, getFirstOrNull, pb } from '$lib/server/pb'
import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

const upsertProviderModel = async (provider: string, modelId: string, enabled: boolean) => {
  const existing = await getFirstOrNull(
    pb
      .collection('provider_models')
      .getFirstListItem(pb.filter('provider = {:p} && modelId = {:m}', { p: provider, m: modelId }))
      .then(mapProviderModel),
  )
  if (existing) {
    await pb.collection('provider_models').update(existing.id, { enabled, updatedAt: now() })
  } else {
    await createOrRecover('provider_models', { provider, modelId, enabled, createdAt: now(), updatedAt: now() }, pb.filter('provider = {:p} && modelId = {:m}', { p: provider, m: modelId }), { enabled, updatedAt: now() })
  }
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const userId = requireUser(locals.user).id

  const provider = url.searchParams.get('provider')
  if (!provider) {
    return json({ error: 'provider query param required' }, { status: 400 })
  }

  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) {
    throw error(400, `No API key configured for ${provider}`)
  }

  const llm = getProviderFactory(provider)(apiKey)
  const allModels = await llm.listModels()

  const stored = (await pb.collection('provider_models').getFullList({ filter: pb.filter('provider = {:p}', { p: provider }) })).map(mapProviderModel)

  const enabledMap = new Map(stored.map(s => [s.modelId, s.enabled]))

  const models = allModels.map(m => ({
    ...m,
    enabled: enabledMap.get(parseModelRef(m.id).model) ?? true,
  }))

  return json(models)
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  requireUser(locals.user)

  const { modelId, enabled } = (await request.json()) as {
    modelId: string
    enabled: boolean
  }

  const { provider, model } = parseModelRef(modelId)

  await upsertProviderModel(provider, model, enabled)

  return json({ success: true })
}

export const PATCH: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id

  const { provider, enabled } = (await request.json()) as {
    provider: string
    enabled: boolean
  }

  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) {
    throw error(400, `No API key configured for ${provider}`)
  }

  const llm = getProviderFactory(provider)(apiKey)
  const allModels = await llm.listModels()

  for (const m of allModels) {
    const { model } = parseModelRef(m.id)
    await upsertProviderModel(provider, model, enabled)
  }

  return json({ success: true })
}
