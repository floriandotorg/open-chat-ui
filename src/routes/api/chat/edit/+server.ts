import { requireUser } from '$lib/server/auth-guard'
import { mapConversation, mapMessage, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId, messageId, content } = (await request.json()) as {
    conversationId: string
    messageId: string
    content: string
  }

  const conversation = await getFirstOrNull(
    pb
      .collection('conversations')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: conversationId, u: userId }))
      .then(mapConversation),
  )

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const targetMsg = await getFirstOrNull(
    pb
      .collection('messages')
      .getFirstListItem(pb.filter('id = {:id} && conversation = {:c}', { id: messageId, c: conversationId }))
      .then(mapMessage),
  )
  if (targetMsg?.role !== 'user') {
    throw error(400, 'Can only edit user messages')
  }

  const newMsgId = crypto.randomUUID()
  await pb.collection('messages').create({
    id: newMsgId,
    conversation: conversationId,
    parentId: targetMsg.parentId,
    role: 'user',
    content,
    images: targetMsg.images ?? null,
    files: targetMsg.files ?? null,
    createdAt: now(),
  })

  const branches: Record<string, string> = conversation.activeBranches ?? {}
  const parentKey = targetMsg.parentId ?? '__root__'
  branches[parentKey] = newMsgId

  await pb.collection('conversations').update(conversationId, { activeBranches: branches, updatedAt: now() })

  return json({ newMessageId: newMsgId })
}
