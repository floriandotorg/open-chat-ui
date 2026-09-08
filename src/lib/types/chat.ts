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
  updatedAt: Date
}

export interface ChatBootstrap {
  conversations: ConversationSummary[]
}

export interface ChatPageData {
  conversation: ConversationSummary & { activeBranches: BranchMap }
  messages: ChatMessage[]
}
