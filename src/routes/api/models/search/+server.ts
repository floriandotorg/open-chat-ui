import { requireUser } from '$lib/server/auth-guard'
import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ locals, url }) => {
  requireUser(locals.user)

  const provider = url.searchParams.get('provider')
  if (!provider) {
    return json({ error: 'provider query param required' }, { status: 400 })
  }

  const llm = getProviderFactory(provider)('')
  if (!llm.searchModels) {
    throw error(400, `${provider} does not support model search`)
  }

  return json(await llm.searchModels(url.searchParams.get('q') ?? ''))
}
