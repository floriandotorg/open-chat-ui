import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { mapMessage, mapUserSettings, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import { getProviderFactory } from '$lib/server/providers'

export const generateConversationTitle = async (userId: string, conversationId: string): Promise<string | null> => {
  const settings = await getFirstOrNull(
    pb
      .collection('user_settings')
      .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
      .then(mapUserSettings),
  )
  if (!settings?.titleModel) return null

  const { provider, model } = parseModelRef(settings.titleModel)

  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) return null

  const result = await pb.collection('messages').getList(1, 4, { filter: pb.filter('conversation = {:c}', { c: conversationId }), sort: 'createdAt' })
  const history = result.items.map(mapMessage)

  if (history.length === 0) return null

  const llm = getProviderFactory(provider)(apiKey)

  let title = ''
  for await (const event of llm.chat({
    model,
    messages: [
      {
        role: 'user',
        content: history.map(m => `${m.role}: ${m.content}`).join('\n\n'),
      },
    ],
    systemPrompt: 'Generate a concise 3-4 word title for this conversation. Respond with ONLY the title, no quotes, no punctuation, no explanation.',
    maxTokens: 25,
    temperature: 0.5,
  })) {
    if (event.type === 'text_delta') {
      title += event.text ?? ''
    }
  }

  title = title
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
  if (!title) return null

  await pb.collection('conversations').update(conversationId, { title, updatedAt: now() })

  return title
}
