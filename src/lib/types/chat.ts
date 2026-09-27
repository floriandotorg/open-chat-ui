import type { BranchMap } from '$lib/message-tree'
import type { Message } from '$lib/types'

export interface ChatMessage extends Message {
  settledAt?: Date
}

export interface ConversationSummary {
  id: string
  title: string
  favorite: boolean
  generating: boolean
  systemPromptId: string | null
  defaultModel: string | null
  updatedAt: Date
}

export const CONVERSATION_SUMMARY_FIELDS = 'id,title,favorite,generating,systemPromptRef,defaultProvider,defaultModel,updatedAt'

export const CONVERSATION_REALTIME_FIELDS = `${CONVERSATION_SUMMARY_FIELDS},activeBranches`

export interface ChatBootstrap {
  conversations: ConversationSummary[]
}

export interface ConversationState {
  generating: boolean
  activeBranches: BranchMap
}

export interface ConversationDetail {
  conversation: ConversationState & { id: string }
  messages: ChatMessage[]
}
