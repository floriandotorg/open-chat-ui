import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, messages, userSettings } from '$lib/server/db/schema'
import { getProviderFactory } from '$lib/server/providers'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const { conversationId } = (await request.json()) as { conversationId: string }

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  if (!settings?.titleModel) {
    throw error(400, 'No title model configured')
  }

  const { provider, model } = parseModelRef(settings.titleModel)

  const apiKey = await getDecryptedKey(userId, provider)
  if (!apiKey) {
    throw error(400, `No API key configured for ${provider}`)
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const history = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).limit(4)

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
  if (!title) {
    throw error(500, 'Failed to generate title')
  }

  const [updated] = await db.update(conversations).set({ title, updatedAt: new Date() }).where(eq(conversations.id, conversationId)).returning()

  return json({ title: updated.title })
}
