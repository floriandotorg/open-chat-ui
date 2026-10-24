import { requireUser } from '#lib/server/auth-guard.ts'
import { getFirstOrNull, pb } from '#lib/server/pb.ts'
import { generateConversationTitle } from '#lib/server/title.ts'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId } = (await request.json()) as { conversationId: string }

  const conversation = await getFirstOrNull(pb.collection('conversations').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: conversationId, u: userId }), { fields: 'title' }))
  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const title = await generateConversationTitle(userId, conversationId)
  return json({ title: title ?? conversation.title })
}
