import { resolveEffectiveParentId } from '$lib/message-tree'
import { requireUser } from '$lib/server/auth-guard'
import { mapConversation, mapMessage, now } from '$lib/server/db/records'
import { startGeneration } from '$lib/server/generate'
import { getFirstOrNull, pb } from '$lib/server/pb'
import { hubToSSE } from '$lib/server/sse'
import { getHub } from '$lib/server/stream-hub'
import type { FileAttachment, ImageAttachment, ThinkingEffort } from '$lib/types'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()
  const {
    conversationId,
    model: modelRef,
    message,
    images: imageIds,
    files: fileAttachments,
    thinkingEffort,
    parentId: requestParentId,
    userMsgId: requestUserMsgId,
    skipUserInsert,
  } = body as {
    conversationId: string
    model: string
    message: string
    images?: ImageAttachment[]
    files?: FileAttachment[]
    thinkingEffort?: ThinkingEffort
    parentId?: string | null
    userMsgId?: string
    skipUserInsert?: boolean
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

  const userMsgId = requestUserMsgId ?? crypto.randomUUID()
  const priorMsgs = (await pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c}', { c: conversationId }), sort: 'createdAt' })).map(mapMessage)
  const effectiveParentId = skipUserInsert ? (requestParentId ?? null) : resolveEffectiveParentId(requestParentId, priorMsgs)
  if (!skipUserInsert) {
    await pb.collection('messages').create({
      id: userMsgId,
      conversation: conversationId,
      parentId: effectiveParentId,
      role: 'user',
      content: message,
      images: imageIds?.length ? imageIds : null,
      files: fileAttachments?.length ? fileAttachments : null,
      createdAt: now(),
    })
  }

  const allMsgs = skipUserInsert ? priorMsgs : (await pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c}', { c: conversationId }), sort: 'createdAt' })).map(mapMessage)
  const byId = new Map(allMsgs.map(m => [m.id, m]))
  const historyIds: string[] = []
  let cur = byId.get(userMsgId)
  while (cur) {
    historyIds.unshift(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }

  const assistantMsgId = crypto.randomUUID()
  const hub = startGeneration({
    userId,
    conversationId,
    modelRef,
    thinkingEffort,
    assistantMsgId,
    parentId: userMsgId,
    historyMessageIds: historyIds,
    branchParentKey: effectiveParentId ?? '__root__',
    titleOnFirst: true,
  })

  return hubToSSE(hub)
}
