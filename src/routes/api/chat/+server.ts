import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, messages } from '$lib/server/db/schema'
import { startGeneration } from '$lib/server/generate'
import { hubToSSE } from '$lib/server/sse'
import { getHub } from '$lib/server/stream-hub'
import type { FileAttachment, ImageAttachment, ThinkingEffort } from '$lib/types'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

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

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  if (getHub(conversationId)) {
    throw error(409, 'Conversation is already generating')
  }

  const userMsgId = requestUserMsgId ?? crypto.randomUUID()
  if (!skipUserInsert) {
    await db.insert(messages).values({
      id: userMsgId,
      conversationId,
      parentId: requestParentId ?? null,
      role: 'user',
      content: message,
      images: imageIds?.length ? JSON.stringify(imageIds) : null,
      files: fileAttachments?.length ? JSON.stringify(fileAttachments) : null,
    })
  }

  await db.update(conversations).set({ generating: true }).where(eq(conversations.id, conversationId))

  const allMsgs = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt))
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
    branchParentKey: requestParentId ?? '__root__',
    titleOnFirst: true,
  })

  return hubToSSE(hub)
}
