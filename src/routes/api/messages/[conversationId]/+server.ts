import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { mapMessage } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const conversation = await getFirstOrNull(pb.collection('conversations').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.conversationId, u: userId }), { fields: 'id' }))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const rows = await pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c}', { c: params.conversationId }), sort: 'createdAt' })

  return json(
    rows.map(row => {
      const m = mapMessage(row)
      return {
        ...m,
        model: normalizeModelRef(m.provider, m.model),
      }
    }),
  )
}
