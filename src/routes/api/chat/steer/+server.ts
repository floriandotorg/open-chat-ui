import { requireUser } from '#lib/server/auth-guard.ts'
import { steerGeneration } from '#lib/server/generations.ts'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

const MAX_STEER_LENGTH = 100_000

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body: unknown = await request.json()
  if (typeof body !== 'object' || body === null || !('conversationId' in body) || !('id' in body) || !('content' in body)) {
    throw error(400, 'Invalid steer')
  }
  const { conversationId, id, content } = body
  if (typeof conversationId !== 'string' || typeof id !== 'string' || typeof content !== 'string' || !content.trim() || content.length > MAX_STEER_LENGTH) {
    throw error(400, 'Invalid steer')
  }
  // The generation is owned by its user, so its lookup is the isolation check.
  return json({ accepted: steerGeneration(conversationId, userId, { id, content }) })
}
