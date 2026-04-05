import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, messages } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId, messageId, content } = (await request.json()) as {
    conversationId: string
    messageId: string
    content: string
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const [targetMsg] = await db.select().from(messages).where(eq(messages.id, messageId))
  if (!targetMsg || targetMsg.role !== 'user') {
    throw error(400, 'Can only edit user messages')
  }

  const newMsgId = crypto.randomUUID()
  await db.insert(messages).values({
    id: newMsgId,
    conversationId,
    parentId: targetMsg.parentId,
    role: 'user',
    content,
    images: targetMsg.images,
    files: targetMsg.files,
  })

  const branches: Record<string, string> = conversation.activeBranches ? JSON.parse(conversation.activeBranches) : {}
  const parentKey = targetMsg.parentId ?? '__root__'
  branches[parentKey] = newMsgId

  await db
    .update(conversations)
    .set({ activeBranches: JSON.stringify(branches), updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))

  return json({ newMessageId: newMsgId })
}
