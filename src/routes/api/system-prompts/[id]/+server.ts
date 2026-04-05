import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { systemPrompts } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  if (body.isDefault) {
    await db
      .update(systemPrompts)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(systemPrompts.userId, userId), eq(systemPrompts.isDefault, true)))
  }

  const [updated] = await db
    .update(systemPrompts)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
      updatedAt: new Date(),
    })
    .where(and(eq(systemPrompts.id, params.id), eq(systemPrompts.userId, userId)))
    .returning()

  if (!updated) {
    throw error(404, 'System prompt not found')
  }

  return json(updated)
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const [prompt] = await db
    .select()
    .from(systemPrompts)
    .where(and(eq(systemPrompts.id, params.id), eq(systemPrompts.userId, userId)))

  if (!prompt) {
    throw error(404, 'System prompt not found')
  }

  if (prompt.isDefault) {
    throw error(400, 'Cannot delete the default system prompt')
  }

  await db.delete(systemPrompts).where(and(eq(systemPrompts.id, params.id), eq(systemPrompts.userId, userId)))

  return new Response(null, { status: 204 })
}
