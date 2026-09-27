import { requireUser } from '$lib/server/auth-guard'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id
  const [conversation, messages] = await Promise.all([
    getFirstOrNull(pb.collection('conversations').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.id, u: userId }), { fields: 'id,generating,activeBranches' })),
    pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c} && conversation.user = {:u}', { c: params.id, u: userId }), sort: 'createdAt' }),
  ])
  if (!conversation) {
    throw error(404, 'Conversation not found')
  }
  return json({ conversation, messages })
}
