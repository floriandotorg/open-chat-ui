import { requireUser } from '$lib/server/auth-guard'
import { pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { messageId } = (await request.json()) as { messageId: string }

  const message = await pb
    .collection('messages')
    .getOne(messageId)
    .catch(() => null)
  if (!message) {
    throw error(404, 'Message not found')
  }

  const conversation = await pb
    .collection('conversations')
    .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: message.conversation, u: userId }))
    .catch(() => null)
  if (!conversation) {
    throw error(404, 'Message not found')
  }

  const branches = (conversation.activeBranches ?? {}) as Record<string, string>
  if (Object.values(branches).includes(messageId)) {
    const pruned = Object.fromEntries(Object.entries(branches).filter(([, v]) => v !== messageId))
    await pb.collection('conversations').update(conversation.id, { activeBranches: pruned })
  }

  await pb.collection('messages').delete(messageId)
  return json({ ok: true })
}
