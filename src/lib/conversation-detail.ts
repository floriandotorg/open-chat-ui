import { mapConversationDetail } from '$lib/db-mappers'
import type { ConversationDetail } from '$lib/types/chat'
import { error } from '@sveltejs/kit'

export const fetchConversationDetail = async (id: string, fetchFn: typeof fetch = fetch): Promise<ConversationDetail> => {
  const res = await fetchFn(`/api/conversations/${encodeURIComponent(id)}/detail`)
  if (!res.ok) {
    throw error(res.status, res.status === 404 ? 'Conversation not found' : 'Failed to load conversation')
  }
  const body = await res.json()
  return mapConversationDetail(body.conversation, body.messages)
}
