import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, messages } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, params.conversationId), eq(conversations.userId, userId)))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const rows = await db.select().from(messages).where(eq(messages.conversationId, params.conversationId)).orderBy(asc(messages.createdAt))

  return json(
    rows.map(m => ({
      ...m,
      model: normalizeModelRef(m.provider, m.model),
    })),
  )
}
