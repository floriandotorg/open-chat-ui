import { mapChatMessage, mapConversationSummary } from '$lib/db-mappers'
import type { ChatBootstrap, ChatPageData } from '$lib/types/chat'
import type { RecordModel } from 'pocketbase'

export type { ApiKey, Conversation, Message, ProviderModel, SystemPrompt, UserSettings } from '$lib/db-mappers'
export {
  mapApiKey,
  mapChatMessage,
  mapClientMessage,
  mapConversation,
  mapConversationSummary,
  mapMessage,
  mapMessagePayload,
  mapProviderModel,
  mapSystemPrompt,
  mapUserSettings,
  now,
} from '$lib/db-mappers'
export { pb } from '$lib/server/pb'
export type { MessagePayload } from '$lib/types'

export const toConversationSummary = mapConversationSummary

export const toChatMessage = mapChatMessage

export const toChatBootstrap = (records: RecordModel[]): ChatBootstrap => ({
  conversations: records.map(mapConversationSummary),
})

export const toChatPageData = (conversation: RecordModel, messages: RecordModel[]): ChatPageData => ({
  conversation: { ...mapConversationSummary(conversation), activeBranches: conversation.activeBranches ?? {} },
  messages: messages.map(mapChatMessage),
})
