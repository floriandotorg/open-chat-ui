import { browser } from '$app/env'
import { fetchConversationDetail } from '#lib/conversation-detail.ts'
import { getChatStores, isChatMounted } from '#lib/stores/chat-sync.svelte.ts'
import type { PageLoad } from './$types'

export const load: PageLoad = async ({ params, fetch }) => {
  const conversationId = params.conversationId
  if (!browser) {
    return { conversationId, initial: await fetchConversationDetail(conversationId, fetch) }
  }
  const stores = getChatStores()
  stores.ensure(conversationId, fetch)
  // Hydration must match the server render; every later navigation renders
  // immediately and lets the store fill in.
  if (!isChatMounted()) {
    await stores.whenLoaded(conversationId)
  }
  return { conversationId, initial: null }
}
