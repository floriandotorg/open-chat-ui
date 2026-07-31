import type { BranchMap } from '$lib/message-tree'
import { resolveAndAnnotate } from '$lib/message-tree'
import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { mapClientMessage, mapConversation } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { PageServerLoad } from './$types'
import { error } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const conversation = await getFirstOrNull(
    pb
      .collection('conversations')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.conversationId, u: userId }))
      .then(mapConversation),
  )

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const allMsgs = (await pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c}', { c: params.conversationId }), sort: 'createdAt' })).map(mapClientMessage)
  const activeBranches: BranchMap = conversation.activeBranches ?? {}

  const activeMessages = resolveAndAnnotate(allMsgs, activeBranches)

  return {
    conversation: {
      ...conversation,
      systemPromptId: conversation.systemPromptId,
      defaultModel: normalizeModelRef(conversation.defaultProvider, conversation.defaultModel),
    },
    messages: activeMessages,
    allMessages: allMsgs,
    activeBranches,
  }
}
