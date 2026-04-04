import { requireAdmin } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { providerModels } from '$lib/server/db/schema'
import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ locals, url }) => {
  requireAdmin(locals.user)

  const provider = url.searchParams.get('provider')
  if (!provider) {
    return json({ error: 'provider query param required' }, { status: 400 })
  }

  const factory = getProviderFactory(provider)
  const allModels = await factory('').listModels()

  const stored = await db.select().from(providerModels).where(eq(providerModels.provider, provider))

  const enabledMap = new Map(stored.map(s => [s.modelId, s.enabled]))

  const models = allModels.map(m => ({
    ...m,
    enabled: enabledMap.get(m.id) ?? true,
  }))

  return json(models)
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals.user)

  const { provider, modelId, enabled } = (await request.json()) as {
    provider: string
    modelId: string
    enabled: boolean
  }

  await db
    .insert(providerModels)
    .values({ provider, modelId, enabled })
    .onConflictDoUpdate({
      target: [providerModels.provider, providerModels.modelId],
      set: { enabled, updatedAt: new Date() },
    })

  return json({ success: true })
}

export const PATCH: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals.user)

  const { provider, enabled } = (await request.json()) as {
    provider: string
    enabled: boolean
  }

  const factory = getProviderFactory(provider)
  const allModels = await factory('').listModels()

  for (const model of allModels) {
    await db
      .insert(providerModels)
      .values({ provider, modelId: model.id, enabled })
      .onConflictDoUpdate({
        target: [providerModels.provider, providerModels.modelId],
        set: { enabled, updatedAt: new Date() },
      })
  }

  return json({ success: true })
}
