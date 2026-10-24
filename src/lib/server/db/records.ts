import { mapChatMessage, mapConversationSummary } from '#lib/db-mappers.ts'
import type { ChatBootstrap } from '#lib/types/chat.ts'
import type { RecordModel } from 'pocketbase'

export type { ApiKey, Conversation, Message, ProviderModel, SystemPrompt, UserSettings } from '#lib/db-mappers.ts'
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
} from '#lib/db-mappers.ts'
export { pb } from '#lib/server/pb.ts'
export type { MessagePayload } from '#lib/types.ts'

export const toConversationSummary = mapConversationSummary

export const toChatMessage = mapChatMessage

export const toChatBootstrap = (records: RecordModel[]): ChatBootstrap => ({
  conversations: records.map(mapConversationSummary),
})
