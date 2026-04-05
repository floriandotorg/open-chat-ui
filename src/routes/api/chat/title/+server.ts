import { requireUser } from '$lib/server/auth-guard'
import { generateConversationTitle } from '$lib/server/title'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId } = (await request.json()) as { conversationId: string }

  const title = await generateConversationTitle(userId, conversationId)
  if (!title) {
    throw error(500, 'Failed to generate title')
  }

  return json({ title })
}
