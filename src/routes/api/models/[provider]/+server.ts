import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params }) => {
  try {
    const provider = getProviderFactory(params.provider)('')
    const models = await provider.listModels()
    return json(models)
  } catch {
    throw error(404, `Unknown provider: ${params.provider}`)
  }
}
