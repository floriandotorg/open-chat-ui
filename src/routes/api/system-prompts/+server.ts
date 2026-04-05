import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { systemPrompts } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { asc, eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const rows = await db.select().from(systemPrompts).where(eq(systemPrompts.userId, userId)).orderBy(asc(systemPrompts.createdAt))
  return json(rows)
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const existing = await db.select({ id: systemPrompts.id }).from(systemPrompts).where(eq(systemPrompts.userId, userId))

  const isFirst = existing.length === 0

  const [created] = await db
    .insert(systemPrompts)
    .values({
      userId,
      title: body.title ?? 'Default',
      content: body.content ?? '',
      isDefault: isFirst,
    })
    .returning()

  return json(created, { status: 201 })
}
