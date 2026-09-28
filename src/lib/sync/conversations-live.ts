import { mapConversationSummary } from '$lib/db-mappers'
import { pbClient } from '$lib/pb-client'
import { noteRealtimeActivity, subscribeShared } from '$lib/realtime-watchdog'
import { conversationStates, conversations } from '$lib/sync/conversations.svelte'
import { CONVERSATION_REALTIME_FIELDS, CONVERSATION_SUMMARY_FIELDS } from '$lib/types/chat'

const resync = async () => {
  const userId = pbClient.authStore.record?.id
  if (!userId) {
    return
  }
  const rows = await pbClient.collection('conversations').getFullList({ filter: pbClient.filter('user = {:u}', { u: userId }), sort: '-updatedAt', fields: CONVERSATION_SUMMARY_FIELDS })
  conversations.reset(rows.map(mapConversationSummary))
  for (const row of rows) {
    conversationStates.merge(row.id, { generating: row.generating ?? false })
  }
}

export const attachConversationsRealtime = () =>
  subscribeShared(
    'conversations',
    () =>
      pbClient.collection('conversations').subscribe(
        '*',
        e => {
          noteRealtimeActivity()
          if (e.action === 'delete') {
            conversations.forget(e.record.id)
            conversationStates.forget(e.record.id)
            return
          }
          conversations.receive(mapConversationSummary(e.record))
          conversationStates.receive({ id: e.record.id, generating: e.record.generating ?? false, activeBranches: e.record.activeBranches ?? {} })
        },
        { fields: CONVERSATION_REALTIME_FIELDS },
      ),
    resync,
  )
