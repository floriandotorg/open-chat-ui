import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { apiKeys } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
  const userId = requireUser(locals.user).id
  const keyId = url.searchParams.get('keyId')

  const where = keyId ? and(eq(apiKeys.userId, userId), eq(apiKeys.provider, params.provider), eq(apiKeys.id, keyId)) : and(eq(apiKeys.userId, userId), eq(apiKeys.provider, params.provider))
  const deleted = await db.delete(apiKeys).where(where).returning({ id: apiKeys.id })

  if (deleted.length === 0) {
    throw error(404, 'API key not found')
  }

  return new Response(null, { status: 204 })
}
