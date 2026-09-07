import { getAncestorPath } from '$lib/message-tree'
import { requireUser } from '$lib/server/auth-guard'
import { mapConversation, mapMessage } from '$lib/server/db/records'
import { startGeneration } from '$lib/server/generate'
import { getGeneration } from '$lib/server/generations'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { ThinkingEffort } from '$lib/types'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()
  const {
    conversationId,
    messageId,
    model: modelRef,
    thinkingEffort,
  } = body as {
    conversationId: string
    messageId: string
    model: string
    thinkingEffort?: ThinkingEffort
  }

  const [conversation, allMsgs] = await Promise.all([
    getFirstOrNull(
      pb
        .collection('conversations')
        .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: conversationId, u: userId }))
        .then(mapConversation),
    ),
    pb
      .collection('messages')
      .getFullList({ filter: pb.filter('conversation = {:c}', { c: conversationId }), sort: 'createdAt' })
      .then(rows => rows.map(mapMessage)),
  ])
  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const existing = getGeneration(conversationId)
  if (existing) {
    if (existing.userId !== userId) {
      throw error(403, 'Forbidden')
    }
    throw error(409, 'Generation already in progress')
  }

  const targetMsg = allMsgs.find(m => m.id === messageId)
  if (targetMsg?.role !== 'assistant') {
    throw error(400, 'Invalid message for regeneration')
  }
  const userParentId = targetMsg.parentId
  if (!userParentId) {
    throw error(400, 'Cannot regenerate: no parent message')
  }

  const ancestorPath = getAncestorPath(userParentId, allMsgs)
  const historyIds = ancestorPath.map(m => m.id)

  const assistantMsgId = crypto.randomUUID()
  startGeneration({
    userId,
    conversationId,
    modelRef,
    thinkingEffort,
    assistantMsgId,
    parentId: userParentId,
    historyMessageIds: historyIds,
    titleOnFirst: false,
    preloaded: { conversation, messages: allMsgs },
  })

  return json({ ok: true })
}
