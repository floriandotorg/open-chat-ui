import { requireUser } from '#lib/server/auth-guard.ts'
import { resolveUserRequest } from '#lib/server/browser/sessions.ts'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const userId = requireUser(locals.user).id
  const body: unknown = await request.json().catch(() => null)
  const outcome = typeof body === 'object' && body !== null && 'outcome' in body ? body.outcome : null
  if (outcome !== 'done' && outcome !== 'declined') {
    throw error(400, 'outcome must be done or declined')
  }
  const requestId = typeof body === 'object' && body !== null && 'requestId' in body && typeof body.requestId === 'string' ? body.requestId : undefined
  if (!resolveUserRequest(params.id, userId, outcome, requestId)) {
    throw error(404, 'Nothing is waiting for you in this browser session')
  }
  return new Response(null, { status: 204 })
}
