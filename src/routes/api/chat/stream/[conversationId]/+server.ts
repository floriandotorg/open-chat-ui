import { requireUser } from '$lib/server/auth-guard'
import { getFirstOrNull, pb } from '$lib/server/pb'
import { clearGeneratingFlag } from '$lib/server/reaper'
import { hubToSSE } from '$lib/server/sse'
import { abortHub, getHub } from '$lib/server/stream-hub'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const userId = requireUser(locals.user).id
  const hub = getHub(params.conversationId)
  if (!hub) {
    const row = await getFirstOrNull(pb.collection('conversations').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.conversationId, u: userId }), { fields: 'id,generating' }))
    if (row?.generating) {
      console.info(`[reaper] no live hub for ${params.conversationId}; clearing stale generating flag`)
      await clearGeneratingFlag(params.conversationId)
    }
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
