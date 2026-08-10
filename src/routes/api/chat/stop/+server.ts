import { requireUser } from '$lib/server/auth-guard'
import { abortGeneration, getGeneration } from '$lib/server/generations'
import { getFirstOrNull, pb } from '$lib/server/pb'
import { clearGeneratingFlag } from '$lib/server/reaper'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId } = (await request.json()) as { conversationId: string }

  const conversation = await getFirstOrNull(pb.collection('conversations').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: conversationId, u: userId }), { fields: 'id' }))
  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const generation = getGeneration(conversationId)
  if (generation) {
    if (generation.userId !== userId) {
      throw error(403, 'Forbidden')
    }
    abortGeneration(conversationId)
  } else {
    // No live generation: the flag is stale (server restart), clear it so
    // the client stops showing the conversation as generating.
    await clearGeneratingFlag(conversationId)
  }
  return new Response(null, { status: 204 })
}
