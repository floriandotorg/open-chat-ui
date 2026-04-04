import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const [deleted] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, params.provider)))
    .returning()

  if (!deleted) {
    throw error(404, 'API key not found')
  }

  return new Response(null, { status: 204 })
}
