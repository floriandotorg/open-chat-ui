import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId, parentKey, selectedChildId } = (await request.json()) as {
    conversationId: string
    parentKey: string
    selectedChildId: string
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const branches: Record<string, string> = conversation.activeBranches ? JSON.parse(conversation.activeBranches) : {}
  branches[parentKey] = selectedChildId

  await db
    .update(conversations)
    .set({ activeBranches: JSON.stringify(branches), updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))

  return json({ ok: true })
}
