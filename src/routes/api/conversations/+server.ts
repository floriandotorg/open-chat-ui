import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { desc, eq } from 'drizzle-orm'

const toConversation = (row: typeof conversations.$inferSelect) => ({
  id: row.id,
  userId: row.userId,
  title: row.title,
  systemPrompt: row.systemPrompt,
  defaultModel: normalizeModelRef(row.defaultProvider, row.defaultModel),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const rows = await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt))

  return json(rows.map(toConversation))
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const [conversation] = await db
    .insert(conversations)
    .values({
      userId,
      title: body.title ?? 'New Chat',
      systemPrompt: body.systemPrompt ?? null,
      defaultModel: body.model ?? null,
    })
    .returning()

  return json(toConversation(conversation), { status: 201 })
}
