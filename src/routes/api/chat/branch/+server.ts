import { requireUser } from '$lib/server/auth-guard'
import { mapConversation, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId, parentKey, selectedChildId } = (await request.json()) as {
    conversationId: string
    parentKey: string
    selectedChildId: string
  }

  const conversation = await getFirstOrNull(
    pb
      .collection('conversations')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: conversationId, u: userId }))
      .then(mapConversation),
  )

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const branches: Record<string, string> = conversation.activeBranches ?? {}
  branches[parentKey] = selectedChildId

  await pb.collection('conversations').update(conversationId, { activeBranches: branches, updatedAt: now() })

  return json({ ok: true })
}
