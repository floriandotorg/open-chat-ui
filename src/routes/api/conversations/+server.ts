import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, systemPrompts } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { and, desc, eq } from 'drizzle-orm'

const toConversation = (row: typeof conversations.$inferSelect) => ({
  id: row.id,
  userId: row.userId,
  title: row.title,
  systemPrompt: row.systemPrompt,
  systemPromptId: row.systemPromptId,
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

  const [defaultPrompt] = await db
    .select()
    .from(systemPrompts)
    .where(and(eq(systemPrompts.userId, userId), eq(systemPrompts.isDefault, true)))

  const [conversation] = await db
    .insert(conversations)
    .values({
      userId,
      title: body.title ?? 'New Chat',
      systemPrompt: defaultPrompt?.content ?? body.systemPrompt ?? null,
      systemPromptId: defaultPrompt?.id ?? null,
      defaultModel: body.model ?? null,
    })
    .returning()

  return json(toConversation(conversation), { status: 201 })
}
