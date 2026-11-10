import { requireUser } from '#lib/server/auth-guard.ts'
import { parseLiveInput } from '#lib/server/browser/live-input.ts'
import { getBrowserSession } from '#lib/server/browser/sessions.ts'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const userId = requireUser(locals.user).id
  const session = getBrowserSession(params.id, userId)
  if (!session) {
    throw error(404, 'Browser session not found')
  }
  const input = parseLiveInput(await request.json().catch(() => null))
  if (!input) {
    throw error(400, 'Invalid input')
  }
  try {
    await session.host.input(session.sessionId, input)
  } catch (err) {
    throw error(502, err instanceof Error ? err.message : 'Could not send input to the browser')
  }
  return new Response(null, { status: 204 })
}
