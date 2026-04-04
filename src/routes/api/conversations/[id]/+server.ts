import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, params.id), eq(conversations.userId, userId)))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  return json(conversation)
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const [updated] = await db
    .update(conversations)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
      ...(body.defaultProvider !== undefined && { defaultProvider: body.defaultProvider }),
      ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
      updatedAt: new Date(),
    })
    .where(and(eq(conversations.id, params.id), eq(conversations.userId, userId)))
    .returning()

  if (!updated) {
    throw error(404, 'Conversation not found')
  }

  return json(updated)
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const [deleted] = await db
    .delete(conversations)
    .where(and(eq(conversations.id, params.id), eq(conversations.userId, userId)))
    .returning()

  if (!deleted) {
    throw error(404, 'Conversation not found')
  }

  return new Response(null, { status: 204 })
}
