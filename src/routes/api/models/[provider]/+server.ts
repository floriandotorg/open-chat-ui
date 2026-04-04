import { db } from '$lib/server/db'
import { providerModels } from '$lib/server/db/schema'
import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ params }) => {
  try {
    const provider = getProviderFactory(params.provider)('')
    const allModels = await provider.listModels()

    const stored = await db.select().from(providerModels).where(eq(providerModels.provider, params.provider))

    if (stored.length === 0) {
      return json(allModels)
    }

    const disabledSet = new Set(stored.filter(s => !s.enabled).map(s => s.modelId))

    return json(allModels.filter(m => !disabledSet.has(m.id)))
  } catch {
    throw error(404, `Unknown provider: ${params.provider}`)
  }
}
