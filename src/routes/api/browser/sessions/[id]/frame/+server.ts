import { requireUser } from '#lib/server/auth-guard.ts'
import { getBrowserSession } from '#lib/server/browser/sessions.ts'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id
  const session = getBrowserSession(params.id, userId)
  if (!session) {
    throw error(404, 'Browser session not found')
  }
  try {
    const frame = await session.host.frame(session.sessionId)
    return new Response(frame.body, { headers: { 'Content-Type': frame.headers.get('Content-Type') ?? 'image/jpeg', 'Cache-Control': 'no-store' } })
  } catch (err) {
    throw error(502, err instanceof Error ? err.message : 'Could not load the browser view')
  }
}
