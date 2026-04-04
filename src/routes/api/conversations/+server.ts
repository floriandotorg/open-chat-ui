import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { desc, eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const rows = await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt))

  return json(rows)
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
      defaultProvider: body.provider ?? null,
      defaultModel: body.model ?? null,
    })
    .returning()

  return json(conversation, { status: 201 })
}
