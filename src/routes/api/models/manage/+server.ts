import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { providerModels } from '$lib/server/db/schema'
import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

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

  const stored = await db.select().from(providerModels).where(eq(providerModels.provider, provider))

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

  await db
    .insert(providerModels)
    .values({ provider, modelId: model, enabled })
    .onConflictDoUpdate({
      target: [providerModels.provider, providerModels.modelId],
      set: { enabled, updatedAt: new Date() },
    })

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
    await db
      .insert(providerModels)
      .values({ provider, modelId: model, enabled })
      .onConflictDoUpdate({
        target: [providerModels.provider, providerModels.modelId],
        set: { enabled, updatedAt: new Date() },
      })
  }

  return json({ success: true })
}
