import { mapSystemPrompt, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'

const findSystemPrompt = (userId: string, systemPromptId: string | null) => {
  const filter = systemPromptId ? pb.filter('id = {:id} && user = {:u}', { id: systemPromptId, u: userId }) : pb.filter('user = {:u} && isDefault = true', { u: userId })
  return getFirstOrNull(pb.collection('system_prompts').getFirstListItem(filter).then(mapSystemPrompt))
}

interface NewConversation {
  id?: string
  title?: string
  systemPromptId: string | null
  fallbackSystemPrompt?: string | null
  defaultModel?: string | null
}

export const createConversation = async (userId: string, { id, title, systemPromptId, fallbackSystemPrompt, defaultModel }: NewConversation) => {
  const prompt = (await findSystemPrompt(userId, systemPromptId)) ?? (systemPromptId ? await findSystemPrompt(userId, null) : null)
  const timestamp = now()
  return pb.collection('conversations').create({
    ...(id && { id }),
    user: userId,
    title: title ?? 'New Chat',
    systemPrompt: prompt?.content ?? fallbackSystemPrompt ?? null,
    systemPromptRef: prompt?.id ?? null,
    defaultModel: defaultModel ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
