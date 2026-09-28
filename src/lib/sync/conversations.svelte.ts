import { api } from '$lib/sync/api'
import { mutate, SyncCollection } from '$lib/sync/collection.svelte'
import type { ConversationState, ConversationSummary } from '$lib/types/chat'

export type ConversationStateRecord = ConversationState & { id: string }

export class ConversationsCollection extends SyncCollection<ConversationSummary> {
  readonly sorted = $derived([...this.list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()))
}

// Sidebar summaries for every conversation, and the heavier per conversation
// state (branch pointers, generation flag) for the ones that were opened.
export const conversations = new ConversationsCollection()
export const conversationStates = new SyncCollection<ConversationStateRecord>()

const patchConversation = (id: string, patch: Partial<ConversationSummary>, body: Record<string, unknown>) => mutate([conversations.patch(id, patch)], () => api.patch(`/api/conversations/${id}`, body))

export const setFavorite = (id: string, favorite: boolean) => patchConversation(id, { favorite }, { favorite })

export const setSystemPrompt = (id: string, systemPromptId: string | null, content: string | null) => patchConversation(id, { systemPromptId }, { systemPromptId, systemPrompt: content })

export const setDefaultModel = (id: string, defaultModel: string | null) => patchConversation(id, { defaultModel }, { defaultModel })

export const deleteConversation = (id: string) => mutate([conversations.delete(id), conversationStates.delete(id)], () => api.delete(`/api/conversations/${id}`))
