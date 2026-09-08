import { requireUser } from '$lib/server/auth-guard'
import { toChatPageData } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { PageServerLoad } from './$types'
import { error } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const [conversation, messages] = await Promise.all([
    getFirstOrNull(pb.collection('conversations').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.conversationId, u: userId }))),
    pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c}', { c: params.conversationId }), sort: 'createdAt' }),
  ])

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  return toChatPageData(conversation, messages)
}
