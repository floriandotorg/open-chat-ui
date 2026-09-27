import { fetchConversationDetail } from '$lib/conversation-detail'
import { getChatStores } from '$lib/stores/chat-sync.svelte'
import { browser } from '$app/environment'
import type { PageLoad } from './$types'

export const load: PageLoad = async ({ params, fetch }) => {
  const conversationId = params.conversationId
  if (!browser) {
    return { conversationId, initial: await fetchConversationDetail(conversationId, fetch) }
  }
  await getChatStores().acquire(conversationId, fetch)
  return { conversationId, initial: null }
}
