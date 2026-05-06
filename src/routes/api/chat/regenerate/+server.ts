import { getAncestorPath } from '$lib/message-tree'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, messages } from '$lib/server/db/schema'
import { startGeneration } from '$lib/server/generate'
import { hubToSSE } from '$lib/server/sse'
import { getHub } from '$lib/server/stream-hub'
import type { ThinkingEffort } from '$lib/types'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

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

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
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

  const allMsgs = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt))
  const targetMsg = allMsgs.find(m => m.id === messageId)
  if (!targetMsg || targetMsg.role !== 'assistant') {
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
