import { canonicalModelRef } from '#lib/model-connection.ts'
import { parseModelRef } from '#lib/model-ref.ts'
import { fallbackModelInfo, storedModelInfo } from '#lib/provider-models.ts'
import { getDecryptedKey } from '#lib/server/api-key.ts'
import { requireUser } from '#lib/server/auth-guard.ts'
import { mapProviderModel, now } from '#lib/server/db/records.ts'
import { resolveUserModelRef } from '#lib/server/model-connection.ts'
import { syncProviderModels } from '#lib/server/model-sync.ts'
import { createOrRecover, getFirstOrNull, pb } from '#lib/server/pb.ts'
import { getProviderFactory } from '#lib/server/providers/index.ts'
import type { ModelInfo } from '#lib/server/providers/types.ts'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

const listStoredModels = async (provider: string) => (await pb.collection('provider_models').getFullList({ filter: pb.filter('provider = {:p}', { p: provider }), sort: 'createdAt' })).map(mapProviderModel)

export const GET: RequestHandler = async ({ locals, url }) => {
  const userId = requireUser(locals.user).id

  const requestedProvider = url.searchParams.get('provider')
  if (!requestedProvider) {
    return json({ error: 'provider query param required' }, { status: 400 })
  }

  const { provider } = parseModelRef(await resolveUserModelRef(userId, `${requestedProvider}/model`))
  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) {
    throw error(400, `No connection configured for ${requestedProvider}`)
  }

  if (url.searchParams.get('refresh') === '1') {
    await syncProviderModels(provider).catch(err => {
      console.error(`[model-sync] ${provider} manual refresh failed:`, err)
    })
  }

  const stored = await listStoredModels(provider)

  return json(
    stored.map(s => {
      const info = storedModelInfo(s)
      return { ...info, id: canonicalModelRef(info.id), name: info.name.replace(/ \(ChatGPT plan\)$/, ''), enabled: s.enabled }
    }),
  )
}

export const POST: RequestHandler = async ({ request, locals }) => {
  requireUser(locals.user)

  const { provider, modelId } = (await request.json()) as {
    provider: string
    modelId: string
  }

  const llm = getProviderFactory(provider)('')
  if (!llm.supportsCustomModels) {
    throw error(400, `${provider} does not support custom models`)
  }

  const info = (await llm.getModelInfo?.(modelId)) ?? fallbackModelInfo(provider, modelId)

  await upsertProviderModel(provider, modelId, true, info)

  return json(info)
}

export const DELETE: RequestHandler = async ({ request, locals }) => {
  requireUser(locals.user)

  const { modelId } = (await request.json()) as { modelId: string }
  const { provider, model } = parseModelRef(modelId)

  const llm = getProviderFactory(provider)('')
  if (!llm.supportsCustomModels) {
    throw error(400, `${provider} does not support custom models`)
  }

  const existing = await getFirstOrNull(
    pb
      .collection('provider_models')
      .getFirstListItem(pb.filter('provider = {:p} && modelId = {:m}', { p: provider, m: model }))
      .then(mapProviderModel),
  )
  if (existing) {
    await pb.collection('provider_models').delete(existing.id)
  }

  return json({ success: true })
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id

  const { modelId, enabled } = (await request.json()) as {
    modelId: string
    enabled: boolean
  }

  const { provider, model } = parseModelRef(await resolveUserModelRef(userId, modelId))

  await upsertProviderModel(provider, model, enabled)

  return json({ success: true })
}

export const PATCH: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id

  const body: { provider: string; enabled: boolean } = await request.json()
  const { enabled } = body
  const { provider } = parseModelRef(await resolveUserModelRef(userId, `${body.provider}/model`))

  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) {
    throw error(400, `No API key configured for ${provider}`)
  }

  const stored = await listStoredModels(provider)
  for (const s of stored) {
    await pb.collection('provider_models').update(s.id, { enabled, updatedAt: now() })
  }

  return json({ success: true })
}

const upsertProviderModel = async (provider: string, modelId: string, enabled: boolean, metadata?: ModelInfo) => {
  const existing = await getFirstOrNull(
    pb
      .collection('provider_models')
      .getFirstListItem(pb.filter('provider = {:p} && modelId = {:m}', { p: provider, m: modelId }))
      .then(mapProviderModel),
  )
  if (existing) {
    await pb.collection('provider_models').update(existing.id, { enabled, ...(metadata ? { metadata } : {}), updatedAt: now() })
  } else {
    await createOrRecover('provider_models', { provider, modelId, enabled, ...(metadata ? { metadata } : {}), createdAt: now(), updatedAt: now() }, pb.filter('provider = {:p} && modelId = {:m}', { p: provider, m: modelId }), { enabled, ...(metadata ? { metadata } : {}), updatedAt: now() })
  }
}
