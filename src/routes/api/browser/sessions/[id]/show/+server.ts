import { requireUser } from '#lib/server/auth-guard.ts'
import { getBrowserSession } from '#lib/server/browser/sessions.ts'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id
  const session = getBrowserSession(params.id, userId)
  if (!session) {
    throw error(404, 'Browser session not found')
  }
  try {
    await session.host.show(session.sessionId)
  } catch (err) {
    throw error(502, err instanceof Error ? err.message : 'Could not show the browser')
  }
  return new Response(null, { status: 204 })
}
