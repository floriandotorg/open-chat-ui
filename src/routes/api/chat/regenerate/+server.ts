import { getAncestorPath } from '$lib/message-tree'
import { requireUser } from '$lib/server/auth-guard'
import { mapConversation, mapMessage } from '$lib/server/db/records'
import { startGeneration } from '$lib/server/generate'
import { getFirstOrNull, pb } from '$lib/server/pb'
import { hubToSSE } from '$lib/server/sse'
import { getHub } from '$lib/server/stream-hub'
import type { ThinkingEffort } from '$lib/types'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

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

  const conversation = await getFirstOrNull(
    pb
      .collection('conversations')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: conversationId, u: userId }))
      .then(mapConversation),
  )
  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const existingHub = getHub(conversationId)
  if (existingHub) {
    if (existingHub.userId !== userId) {
      throw error(403, 'Forbidden')
    }
    return hubToSSE(existingHub)
  }

  const allMsgs = (await pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c}', { c: conversationId }), sort: 'createdAt' })).map(mapMessage)
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
  const hub = startGeneration({
    userId,
    conversationId,
    modelRef,
    thinkingEffort,
    assistantMsgId,
    parentId: userParentId,
    historyMessageIds: historyIds,
    titleOnFirst: false,
  })

  return hubToSSE(hub)
}
