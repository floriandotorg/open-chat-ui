import { requireUser } from '$lib/server/auth-guard'
import { hubToSSE } from '$lib/server/sse'
import { abortHub, getHub } from '$lib/server/stream-hub'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const userId = requireUser(locals.user).id
  const hub = getHub(params.conversationId)
  if (!hub) {
    throw error(404, 'No active stream')
  }
  if (hub.userId !== userId) {
    throw error(403, 'Forbidden')
  }
  const cursor = Number(url.searchParams.get('cursor') ?? '0')
  return hubToSSE(hub, Number.isFinite(cursor) && cursor >= 0 ? cursor : 0)
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id
  const hub = getHub(params.conversationId)
  if (!hub) {
    return new Response(null, { status: 204 })
  }
  if (hub.userId !== userId) {
    throw error(403, 'Forbidden')
  }
  abortHub(params.conversationId)
  return new Response(null, { status: 204 })
}
