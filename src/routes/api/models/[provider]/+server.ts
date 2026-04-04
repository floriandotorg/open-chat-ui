import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { providerModels } from '$lib/server/db/schema'
import { getProviderFactory } from '$lib/server/providers'
import { parseModelRef } from '$lib/model-ref'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const apiKey = await getDecryptedKey(userId, params.provider)
  if (!apiKey) {
    throw error(400, `No API key configured for ${params.provider}`)
  }

  const provider = getProviderFactory(params.provider)(apiKey)
  const allModels = await provider.listModels()

  const stored = await db.select().from(providerModels).where(eq(providerModels.provider, params.provider))

  if (stored.length === 0) {
    return json(allModels)
  }

  const disabledSet = new Set(stored.filter(s => !s.enabled).map(s => s.modelId))

  return json(allModels.filter(m => !disabledSet.has(parseModelRef(m.id).model)))
}
