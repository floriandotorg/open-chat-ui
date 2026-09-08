import type { Message } from '$lib/db-mappers'
import { resolveEffectiveParentId } from '$lib/message-tree'
import { requireUser } from '$lib/server/auth-guard'
import { mapConversation, mapMessage, now, toChatMessage } from '$lib/server/db/records'
import { startGeneration } from '$lib/server/generate'
import { getGeneration } from '$lib/server/generations'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { FileAttachment, ImageAttachment, ThinkingEffort } from '$lib/types'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

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

  const [conversation, priorMsgs] = await Promise.all([
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

  const userMsgId = requestUserMsgId ?? crypto.randomUUID()
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
    // Point the branch at the new user message immediately so every client
    // renders it via realtime instead of waiting for generation to finish.
    const branches: Record<string, string> = { ...(conversation.activeBranches ?? {}), [effectiveParentId ?? '__root__']: userMsgId }
    await pb.collection('conversations').update(conversationId, { activeBranches: branches, updatedAt: now() })
  }

  // The user message was just created above; append it locally instead of
  // re-listing all messages.
  const userMsg: Message = {
    id: userMsgId,
    conversationId,
    parentId: effectiveParentId,
    role: 'user',
    content: message,
    images: imageIds?.length ? imageIds : null,
    files: fileAttachments?.length ? fileAttachments : null,
    provider: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    toolCalls: null,
    cost: null,
    error: null,
    thinking: null,
    thinkingDuration: null,
    eventSeq: 0,
    createdAt: new Date(),
  }
  const allMsgs = skipUserInsert ? priorMsgs : [...priorMsgs, userMsg]
  const byId = new Map(allMsgs.map(m => [m.id, m]))
  const historyIds: string[] = []
  let cur = byId.get(userMsgId)
  while (cur) {
    historyIds.unshift(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }

  const assistantMsgId = crypto.randomUUID()
  startGeneration({
    userId,
    conversationId,
    modelRef,
    thinkingEffort,
    assistantMsgId,
    parentId: userMsgId,
    historyMessageIds: historyIds,
    branchParentKey: effectiveParentId ?? '__root__',
    titleOnFirst: true,
    preloaded: { conversation, messages: allMsgs },
  })

  const userMessage = await pb.collection('messages').getOne(userMsgId).then(toChatMessage)
  return json({ userMessage })
}
